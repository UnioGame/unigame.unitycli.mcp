using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace UniGame.UnityCli.Editor
{
    internal sealed class UnityCliInstallerSpec
    {
        public string Platform;
        public string Url;
        public string Executable;
        public string Arguments;
        public string Extension;
        public string Command;
    }

    internal sealed class UnityCliInstallerResult
    {
        public bool Ok;
        public int ExitCode;
        public string Output;
        public string Error;
    }

    internal static class UnityCliPlatformInstaller
    {
        private const int MaxInstallerBytes = 1024 * 1024;
        private const int MaxOutputCharacters = 16000;

        public static UnityCliInstallerSpec ForPlatform(RuntimePlatform platform)
        {
            switch (platform)
            {
                case RuntimePlatform.WindowsEditor:
                    return new UnityCliInstallerSpec
                    {
                        Platform = "Windows",
                        Url = "https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.ps1",
                        Executable = "powershell.exe",
                        Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"{script}\"",
                        Extension = ".ps1",
                        Command =
                            "$env:UNITY_CLI_CHANNEL='beta'; irm https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.ps1 | iex",
                    };
                case RuntimePlatform.OSXEditor:
                    return Unix(
                        "macOS",
                        "curl -fsSL https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.sh | UNITY_CLI_CHANNEL=beta bash");
                default:
                    return Unix(
                        "Linux",
                        "curl -fsSL https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.sh | UNITY_CLI_CHANNEL=beta bash");
            }
        }

        public static async Task<UnityCliInstallerResult> Install(
            UnityCliInstallerSpec spec,
            CancellationToken cancellationToken)
        {
            return await Install(
                spec,
                cancellationToken,
                Download,
                Run);
        }

        internal static async Task<UnityCliInstallerResult> Install(
            UnityCliInstallerSpec spec,
            CancellationToken cancellationToken,
            Func<string, CancellationToken, Task<byte[]>> download,
            Func<UnityCliInstallerSpec, string, CancellationToken, Task<UnityCliInstallerResult>> execute)
        {
            var scriptPath = Path.Combine(
                Path.GetTempPath(),
                $"unity-cli-install-{Guid.NewGuid():N}{spec.Extension}");
            try
            {
                var bytes = await download(spec.Url, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                if (bytes.Length == 0 || bytes.Length > MaxInstallerBytes)
                    throw new InvalidDataException("Unexpected installer size.");
                File.WriteAllBytes(scriptPath, bytes);

                var result = await execute(spec, scriptPath, cancellationToken);
                result.Output = UnityCliSetupBridge.Sanitize(Bound(result.Output));
                result.Error = UnityCliSetupBridge.Sanitize(Bound(result.Error));
                return result;
            }
            catch (OperationCanceledException)
            {
                return new UnityCliInstallerResult
                {
                    Ok = false,
                    ExitCode = -1,
                    Error = "Install cancelled",
                };
            }
            catch (Exception exception)
            {
                return new UnityCliInstallerResult
                {
                    Ok = false,
                    ExitCode = -1,
                    Error = UnityCliSetupBridge.Sanitize(exception.Message),
                };
            }
            finally
            {
                try
                {
                    if (File.Exists(scriptPath))
                        File.Delete(scriptPath);
                }
                catch
                {
                    // Temporary cleanup is best effort.
                }
            }
        }

        private static async Task<byte[]> Download(
            string url,
            CancellationToken cancellationToken)
        {
            using (var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) })
            using (var response = await client.GetAsync(
                       url,
                       HttpCompletionOption.ResponseHeadersRead,
                       cancellationToken))
            {
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength > MaxInstallerBytes)
                    throw new InvalidDataException("Unexpected installer size.");
                return await response.Content.ReadAsByteArrayAsync();
            }
        }

        internal static ProcessStartInfo CreateStartInfo(
            UnityCliInstallerSpec spec,
            string scriptPath)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = spec.Executable,
                Arguments = spec.Arguments.Replace("{script}", scriptPath),
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            startInfo.EnvironmentVariables["UNITY_CLI_CHANNEL"] = "beta";
            return startInfo;
        }

        private static UnityCliInstallerSpec Unix(string platform, string command)
        {
            return new UnityCliInstallerSpec
            {
                Platform = platform,
                Url = "https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.sh",
                Executable = "/bin/bash",
                Arguments = "\"{script}\"",
                Extension = ".sh",
                Command = command,
            };
        }

        private static async Task<UnityCliInstallerResult> Run(
            UnityCliInstallerSpec spec,
            string scriptPath,
            CancellationToken cancellationToken)
        {
            using (var process = Process.Start(CreateStartInfo(spec, scriptPath)))
            {
                if (process == null)
                    throw new InvalidOperationException("Installer did not start.");

                using (cancellationToken.Register(() => TryKill(process)))
                {
                    var outputTask = process.StandardOutput.ReadToEndAsync();
                    var errorTask = process.StandardError.ReadToEndAsync();
                    var completed = await Task.Run(
                        () => process.WaitForExit((int)TimeSpan.FromMinutes(10).TotalMilliseconds),
                        cancellationToken);
                    if (!completed)
                    {
                        TryKill(process);
                        return new UnityCliInstallerResult
                        {
                            Ok = false,
                            ExitCode = -1,
                            Error = "Install timed out",
                        };
                    }

                    return new UnityCliInstallerResult
                    {
                        Ok = process.ExitCode == 0,
                        ExitCode = process.ExitCode,
                        Output = await outputTask,
                        Error = await errorTask,
                    };
                }
            }
        }

        private static string Bound(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length <= MaxOutputCharacters)
                return value ?? string.Empty;
            return value.Substring(value.Length - MaxOutputCharacters);
        }

        private static void TryKill(Process process)
        {
            try
            {
                if (!process.HasExited)
                    process.Kill();
            }
            catch
            {
                // Cancellation and timeout cleanup are best effort.
            }
        }
    }
}
