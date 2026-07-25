using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace UniGame.UnityCli.Editor
{
    [Serializable]
    internal class UnityCliEditorMetadata
    {
        public int schema_version = 1;
        public long metadata_revision;
        public string project_id;
        public string project_name;
        public string project_path;
        public string editor_instance_id;
        public int editor_pid;
        public string editor_started_at_utc;
        public string editor_version;
        public string package_version;
        public string pipeline_version;
        public string connection_state;
        public string heartbeat_at_utc;
        public string lease_expires_at_utc;
        public string pipeline_descriptor_path;
        public string capability_catalog_hash;
        public int tool_count;
        public bool is_playing;
        public bool is_compiling;
        public int compile_errors_count;
    }

    [Serializable]
    internal sealed class UnityCliBrokerLease
    {
        public int schema_version = 1;
        public string editor_instance_id;
        public int owner_pid;
        public string owner_started_at_utc;
        public string heartbeat_at_utc;
        public string lease_expires_at_utc;
    }

    internal static class UnityCliEditorRegistry
    {
        internal const double HeartbeatSeconds = 2d;
        internal const double LeaseSeconds = 10d;
        private const string SessionIdKey = "UniGame.UnityCli.EditorInstanceId";
        private const string SessionStartedKey = "UniGame.UnityCli.EditorStartedAtUtc";
        private const string SessionRevisionKey = "UniGame.UnityCli.MetadataRevision";

        internal static string NormalizeProjectPath(string path)
        {
            var normalized = Path.GetFullPath(path)
                .Replace('\\', '/')
                .TrimEnd('/');
            return Application.platform == RuntimePlatform.WindowsEditor
                ? normalized.ToLowerInvariant()
                : normalized;
        }

        internal static string ProjectId(string path)
        {
            using var sha256 = SHA256.Create();
            return Hex(sha256.ComputeHash(Encoding.UTF8.GetBytes(NormalizeProjectPath(path))));
        }

        internal static string EditorInstanceId()
        {
            var value = SessionState.GetString(SessionIdKey, string.Empty);
            if (!string.IsNullOrEmpty(value))
                return value;
            value = Guid.NewGuid().ToString("D");
            SessionState.SetString(SessionIdKey, value);
            return value;
        }

        internal static string EditorStartedAtUtc()
        {
            var value = SessionState.GetString(SessionStartedKey, string.Empty);
            if (!string.IsNullOrEmpty(value))
                return value;
            try
            {
                value = Process.GetCurrentProcess().StartTime.ToUniversalTime().ToString("O");
            }
            catch
            {
                value = DateTime.UtcNow.ToString("O");
            }
            SessionState.SetString(SessionStartedKey, value);
            return value;
        }

        internal static int NextMetadataRevision()
        {
            var revision = SessionState.GetInt(SessionRevisionKey, 0) + 1;
            SessionState.SetInt(SessionRevisionKey, revision);
            return revision;
        }

        internal static string DataPath()
        {
            var explicitPath = Environment.GetEnvironmentVariable("UNIGAME_UNITYCLI_DATA_PATH");
            if (!string.IsNullOrWhiteSpace(explicitPath))
                return Path.GetFullPath(explicitPath);
            if (Application.platform == RuntimePlatform.WindowsEditor)
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "UniGame");
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".local",
                "share",
                "unigame");
        }

        internal static string LeasePath(string dataPath, string projectId, string instanceId)
        {
            return Path.Combine(
                dataPath,
                "unity-cli-mcp",
                "registry",
                "editors",
                projectId,
                instanceId + ".json");
        }

        internal static void AtomicWrite(string path, string content)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new InvalidOperationException());
            var temporary = path + ".tmp-" + Process.GetCurrentProcess().Id;
            File.WriteAllText(temporary, content, new UTF8Encoding(false));
            if (File.Exists(path))
                File.Replace(temporary, path, null);
            else
                File.Move(temporary, path);
        }

        internal static bool DeleteOwnLease(string path, string editorInstanceId)
        {
            if (!File.Exists(path))
                return false;
            try
            {
                var metadata = JsonUtility.FromJson<UnityCliEditorMetadata>(File.ReadAllText(path));
                if (metadata == null || metadata.editor_instance_id != editorInstanceId)
                    return false;
                File.Delete(path);
                return true;
            }
            catch
            {
                return false;
            }
        }

        internal static bool RenewOwnBrokerLease(
            string path,
            string editorInstanceId,
            int ownerPid,
            string ownerStartedAtUtc,
            DateTime now)
        {
            if (!File.Exists(path))
                return false;
            try
            {
                var lease = JsonUtility.FromJson<UnityCliBrokerLease>(File.ReadAllText(path));
                if (lease == null ||
                    lease.schema_version != 1 ||
                    lease.editor_instance_id != editorInstanceId ||
                    lease.owner_pid != ownerPid ||
                    lease.owner_started_at_utc != ownerStartedAtUtc)
                    return false;
                lease.heartbeat_at_utc = now.ToString("O");
                lease.lease_expires_at_utc = now.AddSeconds(LeaseSeconds).ToString("O");
                AtomicWrite(path, JsonUtility.ToJson(lease, true));
                return true;
            }
            catch
            {
                return false;
            }
        }

        internal static bool DeleteOwnBrokerLease(
            string path,
            string editorInstanceId,
            int ownerPid,
            string ownerStartedAtUtc)
        {
            if (!File.Exists(path))
                return false;
            try
            {
                var lease = JsonUtility.FromJson<UnityCliBrokerLease>(File.ReadAllText(path));
                if (lease == null ||
                    lease.editor_instance_id != editorInstanceId ||
                    lease.owner_pid != ownerPid ||
                    lease.owner_started_at_utc != ownerStartedAtUtc)
                    return false;
                File.Delete(path);
                return true;
            }
            catch
            {
                return false;
            }
        }

        internal static string Hex(byte[] bytes)
        {
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (var value in bytes)
                builder.Append(value.ToString("x2"));
            return builder.ToString();
        }
    }

    [InitializeOnLoad]
    internal static class UnityCliEditorRegistryPublisher
    {
        private static readonly string ProjectPath = UnityCliSetupBridge.ProjectPath();
        private static readonly string ProjectId = UnityCliEditorRegistry.ProjectId(ProjectPath);
        private static readonly string InstanceId = UnityCliEditorRegistry.EditorInstanceId();
        private static readonly string StartedAt = UnityCliEditorRegistry.EditorStartedAtUtc();
        private static readonly string DescriptorPath =
            Path.Combine(ProjectPath, "Library", "Pipeline", ".unity-pipeline-port");
        private static readonly string LeasePath = UnityCliEditorRegistry.LeasePath(
            UnityCliEditorRegistry.DataPath(),
            ProjectId,
            InstanceId);
        private static readonly int EditorPid = Process.GetCurrentProcess().Id;
        private static readonly string BrokerLeasePath = Path.Combine(
            UnityCliEditorRegistry.DataPath(),
            "unity-cli-mcp",
            "broker-leases",
            InstanceId + ".json");
        private static double _nextHeartbeat;
        private static int _compileErrors;

        static UnityCliEditorRegistryPublisher()
        {
            EditorApplication.update += Update;
            EditorApplication.quitting += Quit;
            AssemblyReloadEvents.beforeAssemblyReload += BeforeDomainReload;
            CompilationPipeline.compilationStarted += CompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += AssemblyCompilationFinished;
            Publish();
        }

        private static void Update()
        {
            if (EditorApplication.timeSinceStartup < _nextHeartbeat)
                return;
            Publish();
        }

        private static void Publish()
        {
            _nextHeartbeat = EditorApplication.timeSinceStartup +
                             UnityCliEditorRegistry.HeartbeatSeconds;
            try
            {
                var now = DateTime.UtcNow;
                var package = UnityCliSetupBridge.FindPackage("com.unigame.unitycli.mcp");
                var pipeline = UnityCliSetupBridge.FindPackage("com.unity.pipeline");
                var metadata = new UnityCliEditorMetadata
                {
                    metadata_revision = UnityCliEditorRegistry.NextMetadataRevision(),
                    project_id = ProjectId,
                    project_name = new DirectoryInfo(ProjectPath).Name,
                    project_path = Path.GetFullPath(ProjectPath),
                    editor_instance_id = InstanceId,
                    editor_pid = Process.GetCurrentProcess().Id,
                    editor_started_at_utc = StartedAt,
                    editor_version = Application.unityVersion,
                    package_version = package?.version ?? "unknown",
                    pipeline_version = pipeline?.version ?? "unknown",
                    connection_state = File.Exists(DescriptorPath) ? "ready" : "not_ready",
                    heartbeat_at_utc = now.ToString("O"),
                    lease_expires_at_utc = now.AddSeconds(UnityCliEditorRegistry.LeaseSeconds).ToString("O"),
                    pipeline_descriptor_path = Path.GetFullPath(DescriptorPath),
                    capability_catalog_hash = CatalogHash(package?.resolvedPath),
                    tool_count = 140,
                    is_playing = EditorApplication.isPlaying,
                    is_compiling = EditorApplication.isCompiling,
                    compile_errors_count = _compileErrors,
                };
                UnityCliEditorRegistry.AtomicWrite(LeasePath, JsonUtility.ToJson(metadata, true));
                UnityCliEditorRegistry.RenewOwnBrokerLease(
                    BrokerLeasePath,
                    InstanceId,
                    EditorPid,
                    StartedAt,
                    now);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"Unity CLI registry heartbeat failed: {exception.Message}");
            }
        }

        private static string CatalogHash(string packagePath)
        {
            if (string.IsNullOrEmpty(packagePath))
                return "unavailable";
            var path = Path.Combine(
                packagePath,
                "Server~",
                "catalogs",
                "pipeline-editor-0.4.0-exp.1-6000.3.14f1.json");
            if (!File.Exists(path))
                return "unavailable";
            using var sha256 = SHA256.Create();
            return UnityCliEditorRegistry.Hex(sha256.ComputeHash(File.ReadAllBytes(path)));
        }

        private static void CompilationStarted(object context)
        {
            _compileErrors = 0;
        }

        private static void AssemblyCompilationFinished(string assembly, CompilerMessage[] messages)
        {
            foreach (var message in messages)
                if (message.type == CompilerMessageType.Error)
                    _compileErrors++;
        }

        private static void BeforeDomainReload()
        {
            Unsubscribe();
        }

        private static void Quit()
        {
            Unsubscribe();
            UnityCliEditorRegistry.DeleteOwnLease(LeasePath, InstanceId);
            UnityCliEditorRegistry.DeleteOwnBrokerLease(
                BrokerLeasePath,
                InstanceId,
                EditorPid,
                StartedAt);
        }

        private static void Unsubscribe()
        {
            EditorApplication.update -= Update;
            EditorApplication.quitting -= Quit;
            AssemblyReloadEvents.beforeAssemblyReload -= BeforeDomainReload;
            CompilationPipeline.compilationStarted -= CompilationStarted;
            CompilationPipeline.assemblyCompilationFinished -= AssemblyCompilationFinished;
        }
    }
}
