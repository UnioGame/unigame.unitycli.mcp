using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace UniGame.UnityCli.Editor
{
    [Serializable]
    internal sealed class UnityCliSetupRequest
    {
        public string operation;
        public string projectPath;
        public string packageRoot;
        public string[] agents;
        public string[] disabledAgents;
        public string transport;
        public bool confirm;
        public bool force;
        public bool installServer;
        public bool installSkill;
        public int port;
        public int ownerPid;
        public string backupId;
        public bool stop;
    }

    [Serializable]
    internal sealed class UnityCliSetupResponse
    {
        public bool ok;
        public string operation;
        public UnityCliPlannedChange[] changes = Array.Empty<UnityCliPlannedChange>();
        public string[] warnings = Array.Empty<string>();
        public string[] errors = Array.Empty<string>();
        public string backup;
        public string[] restartRequired = Array.Empty<string>();
        public UnityCliSetupData data = new UnityCliSetupData();

        public static UnityCliSetupResponse Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
                return null;
            try
            {
                return JsonUtility.FromJson<UnityCliSetupResponse>(json);
            }
            catch (ArgumentException)
            {
                return null;
            }
        }
    }

    [Serializable]
    internal sealed class UnityCliPlannedChange
    {
        public string kind;
        public string target;
        public string summary;
        public string agent;
        public bool conflict;
    }

    [Serializable]
    internal sealed class UnityCliSetupData
    {
        public string toolkitVersion;
        public UnityCliNodeStatus node = new UnityCliNodeStatus();
        public UnityCliExecutableStatus unityCli = new UnityCliExecutableStatus();
        public UnityCliPipelineStatus pipeline = new UnityCliPipelineStatus();
        public UnityCliEditorStatus editor = new UnityCliEditorStatus();
        public string projectPath;
        public string projectRoot;
        public string serverName;
        public string installRoot;
        public bool serverInstalled;
        public bool serverExists;
        public bool serverExecutable;
        public UnityCliAgentStatus[] agents = Array.Empty<UnityCliAgentStatus>();
        public bool skillInstalled;
        public UnityCliHttpStatus http = new UnityCliHttpStatus();
        public UnityCliRegistrationStatus[] registrations =
            Array.Empty<UnityCliRegistrationStatus>();
        public bool stopped;
        public bool alreadyRunning;
        public bool pendingHealth;
        public int pid;
        public int port;
    }

    [Serializable]
    internal sealed class UnityCliNodeStatus
    {
        public string path;
        public string version;
        public bool supported;
    }

    [Serializable]
    internal sealed class UnityCliExecutableStatus
    {
        public string path;
        public string version;
        public string expected;
    }

    [Serializable]
    internal sealed class UnityCliPipelineStatus
    {
        public bool installed;
        public string version;
        public string expected;
    }

    [Serializable]
    internal sealed class UnityCliEditorStatus
    {
        public bool connected;
        public string status;
    }

    [Serializable]
    internal sealed class UnityCliAgentStatus
    {
        public string id;
        public string displayName;
        public bool installed;
        public string configPath;
        public string format;
        public string key;
        public bool restartRequired;
        public bool configured;
        public bool conflict;
    }

    [Serializable]
    internal sealed class UnityCliHttpStatus
    {
        public int pid;
        public int port;
        public int ownerPid;
        public bool alive;
        public string url;
    }

    [Serializable]
    internal sealed class UnityCliRegistrationStatus
    {
        public string id;
        public bool configured;
    }

    internal enum UnityCliEnvironmentState
    {
        Ready,
        Missing,
        Warning,
        Error,
    }

    internal sealed class UnityCliSetupPresenter
    {
        internal static readonly string[] SupportedAgentIds =
        {
            "codex",
            "cursor",
            "vscode",
            "cline",
            "claude-code",
            "claude-desktop",
        };

        private readonly HashSet<string> _selectedAgents =
            new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, UnityCliAgentStatus> _agentStatuses =
            new Dictionary<string, UnityCliAgentStatus>(StringComparer.Ordinal);

        public bool Busy { get; private set; }
        public bool PreviewReady { get; private set; }
        public bool ForceVisible { get; private set; }
        public bool Force { get; set; }
        public bool InstallSkill { get; set; } = true;
        public bool UseHttp { get; set; }
        public int HttpPort { get; set; }
        public string LastBackup { get; private set; } = string.Empty;
        public UnityCliSetupResponse LastResponse { get; private set; }
        public IReadOnlyCollection<string> SelectedAgents => _selectedAgents;
        public IReadOnlyCollection<string> DisabledAgents => _agentStatuses.Values
            .Where(status => status.configured && !_selectedAgents.Contains(status.id))
            .Select(status => status.id)
            .ToArray();

        public bool CanReview(
            string nodePath,
            string nodeVersion,
            string cliPath,
            string setupPath)
        {
            return !Busy &&
                   !string.IsNullOrEmpty(nodePath) &&
                   IsSupportedNode(nodeVersion) &&
                   !string.IsNullOrEmpty(cliPath) &&
                   !string.IsNullOrEmpty(setupPath) &&
                   (_selectedAgents.Count > 0 || DisabledAgents.Count > 0);
        }

        public bool CanApply(
            string nodePath,
            string nodeVersion,
            string cliPath,
            string setupPath)
        {
            return PreviewReady && CanReview(nodePath, nodeVersion, cliPath, setupPath);
        }

        public void InitializeAgents(
            IEnumerable<UnityCliAgentStatus> agents,
            bool preferencesExist,
            IEnumerable<string> savedSelection)
        {
            _selectedAgents.Clear();
            UpdateAgentStatuses(agents);
            if (preferencesExist)
            {
                foreach (var id in savedSelection ?? Array.Empty<string>())
                    if (SupportedAgentIds.Contains(id) &&
                        (_agentStatuses.Count == 0 || CanToggleAgent(id)))
                        _selectedAgents.Add(id);
                return;
            }

            foreach (var agent in agents ?? Array.Empty<UnityCliAgentStatus>())
                if (agent != null && agent.installed && SupportedAgentIds.Contains(agent.id))
                    _selectedAgents.Add(agent.id);
        }

        public void UpdateAgentStatuses(IEnumerable<UnityCliAgentStatus> agents)
        {
            _agentStatuses.Clear();
            foreach (var agent in agents ?? Array.Empty<UnityCliAgentStatus>())
            {
                if (agent == null || !SupportedAgentIds.Contains(agent.id))
                    continue;
                _agentStatuses[agent.id] = agent;
            }

            _selectedAgents.RemoveWhere(id =>
                !_agentStatuses.TryGetValue(id, out var status) ||
                (!status.installed && !status.configured));
        }

        public void SetAgentSelected(string id, bool selected)
        {
            if (selected)
                _selectedAgents.Add(id);
            else
                _selectedAgents.Remove(id);
            InvalidatePreview();
        }

        public bool IsAgentSelected(string id)
        {
            return _selectedAgents.Contains(id);
        }

        public bool CanToggleAgent(string id)
        {
            return _agentStatuses.TryGetValue(id, out var status) &&
                   (status.installed || status.configured);
        }

        public string AgentDetection(string id)
        {
            return _agentStatuses.TryGetValue(id, out var status) && status.installed
                ? "Found"
                : "Missing";
        }

        public string AgentIntegration(string id)
        {
            if (!_agentStatuses.TryGetValue(id, out var status))
                return "Off";
            if (status.conflict)
                return "Conflict";
            var selected = _selectedAgents.Contains(id);
            if (selected && !status.configured)
                return "Pending On";
            if (!selected && status.configured)
                return "Pending Off";
            return status.configured ? "On" : "Off";
        }

        public string AgentToggleValue(string id)
        {
            return _selectedAgents.Contains(id) ? "On" : "Off";
        }

        public void SetBusy(bool busy)
        {
            Busy = busy;
        }

        public void AcceptResponse(UnityCliSetupResponse response)
        {
            LastResponse = response;
            if (!string.IsNullOrEmpty(response?.backup))
                LastBackup = response.backup;

            if (string.Equals(response?.operation, "plan", StringComparison.Ordinal) &&
                response.ok)
            {
                PreviewReady = true;
                ForceVisible = response.changes?.Any(change => change.conflict) == true;
                if (!ForceVisible)
                    Force = false;
                return;
            }

            PreviewReady = false;
            ForceVisible = false;
            Force = false;
        }

        public void InvalidatePreview()
        {
            PreviewReady = false;
            ForceVisible = false;
            Force = false;
        }

        public static bool IsSupportedNode(string version)
        {
            if (string.IsNullOrWhiteSpace(version))
                return false;
            var normalized = version.Trim().TrimStart('v');
            var separator = normalized.IndexOf('.');
            if (separator >= 0)
                normalized = normalized.Substring(0, separator);
            return int.TryParse(normalized, out var major) && major >= 20;
        }
    }
}
