using System;
using UnityEngine;

namespace UniGame.UnityCli.Editor
{
    [Serializable]
    internal sealed class UnityCliSetupRequest
    {
        public string operation;
        public string project_path;
        public string package_root;
        public string[] agent_ids = Array.Empty<string>();
        public string[] disabled_agent_ids = Array.Empty<string>();
        public string[] skill_ids = Array.Empty<string>();
        public string[] disabled_skill_ids = Array.Empty<string>();
        public string target_kind;
        public string target_id;
        public string transport;
        public bool confirm;
        public bool force;
        public bool install_server;
        public int port;
        public int owner_pid;
        public string editor_instance_id;
        public string owner_started_at_utc;
        public bool keep_alive;
        public string backup_id;
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
        public string[] restart_required = Array.Empty<string>();
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
        public string agent_id;
        public string skill_id;
        public bool conflict;
    }

    [Serializable]
    internal sealed class UnityCliSetupData
    {
        public string toolkit_version;
        public UnityCliNodeStatus node = new UnityCliNodeStatus();
        public UnityCliExecutableStatus unity_cli = new UnityCliExecutableStatus();
        public UnityCliPipelineStatus pipeline = new UnityCliPipelineStatus();
        public UnityCliCurrentEditorStatus current_editor = new UnityCliCurrentEditorStatus();
        public UnityCliOfficialMcpStatus official_mcp = new UnityCliOfficialMcpStatus();
        public UnityCliAgentStatus[] agents = Array.Empty<UnityCliAgentStatus>();
        public UnityCliSkillStatus[] skills = Array.Empty<UnityCliSkillStatus>();
        public UnityCliAdvancedBrokerStatus advanced_broker =
            new UnityCliAdvancedBrokerStatus();
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
        public bool ready;
        public string error;
    }

    [Serializable]
    internal sealed class UnityCliPipelineStatus
    {
        public bool installed;
        public string version;
        public string expected;
        public bool ready;
        public string error;
    }

    [Serializable]
    internal sealed class UnityCliCurrentEditorStatus
    {
        public string project_path;
        public string project_id;
        public string editor_instance_id;
        public string editor_version;
        public string state;
        public bool ready;
        public int tool_count;
        public string error;
    }

    [Serializable]
    internal sealed class UnityCliOfficialMcpStatus
    {
        public string state = "not_ready";
        public int tool_count;
        public string error;
    }

    [Serializable]
    internal sealed class UnityCliAgentStatus
    {
        public string agent_id;
        public string display_name;
        public bool detected;
        public string registration_state;
        public bool managed;
        public bool restart_required;
    }

    [Serializable]
    internal sealed class UnityCliSkillStatus
    {
        public string skill_id;
        public string display_name;
        public string state;
        public string install_path;
    }

    [Serializable]
    internal sealed class UnityCliAdvancedBrokerStatus
    {
        public string state;
        public string transport;
        public string endpoint;
        public int port;
        public int pid;
        public bool running;
        public int connected_project_count;
        public string error;
    }
}
