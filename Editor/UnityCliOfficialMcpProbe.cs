using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace UniGame.UnityCli.Editor
{
    internal interface IUnityCliStdioSession : IDisposable
    {
        void Start(string executable, IReadOnlyList<string> arguments);

        Task WriteLineAsync(string line, CancellationToken cancellationToken);

        Task<string> ReadLineAsync(CancellationToken cancellationToken);

        void Terminate();
    }

    internal sealed class UnityCliOfficialMcpProbeResult
    {
        public string state = "error";
        public int tool_count;
        public string error;
    }

    internal sealed class UnityCliOfficialMcpProbe
    {
        private const int InitializeRequestId = 1;
        private const int ToolsListRequestId = 2;

        private readonly Func<IUnityCliStdioSession> _sessionFactory;

        public UnityCliOfficialMcpProbe()
            : this(() => new UnityCliProcessStdioSession())
        {
        }

        internal UnityCliOfficialMcpProbe(Func<IUnityCliStdioSession> sessionFactory)
        {
            _sessionFactory = sessionFactory ??
                              throw new ArgumentNullException(nameof(sessionFactory));
        }

        public async Task<UnityCliOfficialMcpProbeResult> Test(
            string unityCliPath,
            string projectPath,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(unityCliPath) || !Path.IsPathRooted(unityCliPath))
                return Error("Unity CLI must resolve to an absolute executable path.");
            if (!File.Exists(unityCliPath))
                return Error("Unity CLI executable was not found.");
            if (string.IsNullOrWhiteSpace(projectPath) || !Path.IsPathRooted(projectPath))
                return Error("The Unity project path must be absolute.");

            using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken);
            timeoutSource.CancelAfter(timeout);
            using var session = _sessionFactory();
            try
            {
                session.Start(
                    Path.GetFullPath(unityCliPath),
                    new[] { "mcp", "--project-path", Path.GetFullPath(projectPath) });
                await session.WriteLineAsync(
                    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"," +
                    "\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{}," +
                    "\"clientInfo\":{\"name\":\"unity-editor-setup\",\"version\":\"1\"}}}",
                    timeoutSource.Token);
                var initialize = await ReadResponse(
                    session,
                    InitializeRequestId,
                    timeoutSource.Token);
                if (initialize.error != null &&
                    (initialize.error.code != 0 ||
                     !string.IsNullOrWhiteSpace(initialize.error.message)))
                    return Error(ValueOr(initialize.error.message, "initialize failed"));

                await session.WriteLineAsync(
                    "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"," +
                    "\"params\":{}}",
                    timeoutSource.Token);
                await session.WriteLineAsync(
                    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}",
                    timeoutSource.Token);
                var tools = await ReadResponse(
                    session,
                    ToolsListRequestId,
                    timeoutSource.Token);
                if (tools.error != null &&
                    (tools.error.code != 0 ||
                     !string.IsNullOrWhiteSpace(tools.error.message)))
                    return Error(ValueOr(tools.error.message, "tools/list failed"));
                var toolCount = tools.result?.tools?.Length ?? 0;
                if (toolCount == 0)
                {
                    return Error(
                        "MCP connected, but no Pipeline tools were published. " +
                        "Open this project in Unity and wait for Pipeline to become ready.");
                }

                return new UnityCliOfficialMcpProbeResult
                {
                    state = "verified",
                    tool_count = toolCount,
                    error = string.Empty,
                };
            }
            catch (OperationCanceledException)
            {
                return Error(
                    cancellationToken.IsCancellationRequested
                        ? "MCP test was cancelled."
                        : "MCP test timed out.");
            }
            catch (Exception exception)
            {
                return Error(UnityCliSetupBridge.Sanitize(exception.Message));
            }
            finally
            {
                session.Terminate();
            }
        }

        private static async Task<JsonRpcResponse> ReadResponse(
            IUnityCliStdioSession session,
            int expectedId,
            CancellationToken cancellationToken)
        {
            while (true)
            {
                var line = await session.ReadLineAsync(cancellationToken);
                if (line == null)
                    throw new IOException("Unity CLI closed stdio before replying.");
                if (string.IsNullOrWhiteSpace(line))
                    continue;
                JsonRpcResponse response;
                try
                {
                    response = JsonUtility.FromJson<JsonRpcResponse>(line);
                }
                catch (ArgumentException)
                {
                    continue;
                }

                if (response != null && response.id == expectedId)
                    return response;
            }
        }

        private static UnityCliOfficialMcpProbeResult Error(string message)
        {
            return new UnityCliOfficialMcpProbeResult
            {
                state = "error",
                error = message,
            };
        }

        private static string ValueOr(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value;
        }

        [Serializable]
        private sealed class JsonRpcResponse
        {
            public int id;
            public JsonRpcResult result;
            public JsonRpcError error;
        }

        [Serializable]
        private sealed class JsonRpcResult
        {
            public JsonRpcTool[] tools = Array.Empty<JsonRpcTool>();
        }

        [Serializable]
        private sealed class JsonRpcTool
        {
            public string name;
        }

        [Serializable]
        private sealed class JsonRpcError
        {
            public int code;
            public string message;
        }
    }

    internal sealed class UnityCliProcessStdioSession : IUnityCliStdioSession
    {
        private Process _process;

        public void Start(string executable, IReadOnlyList<string> arguments)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = executable,
                Arguments = JoinArguments(arguments),
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            _process = Process.Start(startInfo) ??
                       throw new InvalidOperationException("Could not start Unity CLI.");
        }

        public async Task WriteLineAsync(
            string line,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await _process.StandardInput.WriteLineAsync(line);
            await _process.StandardInput.FlushAsync();
            cancellationToken.ThrowIfCancellationRequested();
        }

        public async Task<string> ReadLineAsync(CancellationToken cancellationToken)
        {
            var read = _process.StandardOutput.ReadLineAsync();
            var cancelled = Task.Delay(Timeout.Infinite, cancellationToken);
            var completed = await Task.WhenAny(read, cancelled);
            cancellationToken.ThrowIfCancellationRequested();
            return await read;
        }

        public void Terminate()
        {
            if (_process == null)
                return;
            try
            {
                if (!_process.HasExited)
                {
                    _process.StandardInput.Close();
                    if (!_process.WaitForExit(1000))
                    {
                        _process.Kill();
                        _process.WaitForExit(1000);
                    }
                }
            }
            catch (InvalidOperationException)
            {
            }
        }

        public void Dispose()
        {
            Terminate();
            _process?.Dispose();
            _process = null;
        }

        private static string JoinArguments(IReadOnlyList<string> arguments)
        {
            var encoded = new string[arguments.Count];
            for (var index = 0; index < arguments.Count; index++)
                encoded[index] = QuoteArgument(arguments[index]);
            return string.Join(" ", encoded);
        }

        private static string QuoteArgument(string value)
        {
            if (string.IsNullOrEmpty(value))
                return "\"\"";
            if (value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
                return value;

            var result = new StringBuilder("\"");
            var slashCount = 0;
            foreach (var character in value)
            {
                if (character == '\\')
                {
                    slashCount++;
                    continue;
                }

                if (character == '"')
                    result.Append('\\', slashCount * 2 + 1);
                else
                    result.Append('\\', slashCount);
                result.Append(character);
                slashCount = 0;
            }

            result.Append('\\', slashCount * 2);
            result.Append('"');
            return result.ToString();
        }
    }
}
