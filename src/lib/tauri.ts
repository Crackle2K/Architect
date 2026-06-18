import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  BackupInfo,
  CreateServerRequest,
  FileEntry,
  McVersion,
  PlayerListEntry,
  PlayersResult,
  PropertyEntry,
  ResourceUsage,
  ScheduledTask,
  ServerConfig,
  ServerInfo,
  ServerType,
  StatusEvent,
  UpdateServerRequest,
} from "../types";

export const listServers = (): Promise<ServerInfo[]> =>
  invoke("list_servers");

export const createServer = (req: CreateServerRequest): Promise<ServerConfig> =>
  invoke("create_server", { req });

export const deleteServer = (id: string): Promise<void> =>
  invoke("delete_server", { id });

export const updateServer = (id: string, req: UpdateServerRequest): Promise<ServerConfig> =>
  invoke("update_server", { id, req });

export const startServer = (id: string): Promise<void> =>
  invoke("start_server", { id });

export const stopServer = (id: string): Promise<void> =>
  invoke("stop_server", { id });

export const restartServer = (id: string): Promise<void> =>
  invoke("restart_server", { id });

export const sendCommand = (id: string, command: string): Promise<void> =>
  invoke("send_command", { id, command });

export const getServerStatus = (id: string): Promise<StatusEvent> =>
  invoke("get_server_status", { id });

export const getMcVersions = (serverType: ServerType): Promise<McVersion[]> =>
  invoke("get_minecraft_versions", { serverType });

export const queryPlayers = (id: string): Promise<PlayersResult> =>
  invoke("query_players", { id });

export const listServerFiles = (id: string, subpath: string | null): Promise<FileEntry[]> =>
  invoke("list_server_files", { id, subpath });

export const readServerFile = (id: string, path: string): Promise<string> =>
  invoke("read_server_file", { id, path });

export const writeServerFile = (id: string, path: string, content: string): Promise<void> =>
  invoke("write_server_file", { id, path, content });

export const deleteServerFile = (id: string, path: string): Promise<void> =>
  invoke("delete_server_file", { id, path });

export const openServerFile = (id: string, path: string | null): Promise<void> =>
  invoke("open_server_file", { id, path });

export const uploadServerFile = (id: string, path: string, contentB64: string): Promise<void> =>
  invoke("upload_server_file", { id, path, contentB64 });

export const getSettings = (): Promise<AppSettings> =>
  invoke("get_settings");

export const saveSettings = (settings: AppSettings): Promise<void> =>
  invoke("save_settings", { settings });

export const getDataDir = (): Promise<string> =>
  invoke("get_data_dir");

export const openPath = (path: string): Promise<void> =>
  invoke("open_path", { path });

// Resource monitor
export const getServerResources = (id: string): Promise<ResourceUsage> =>
  invoke("get_server_resources", { id });

// Backups
export const listBackups = (id: string): Promise<BackupInfo[]> =>
  invoke("list_backups", { id });

export const createBackup = (id: string, label?: string): Promise<BackupInfo> =>
  invoke("create_backup", { id, label: label ?? null });

export const deleteBackup = (id: string, name: string): Promise<void> =>
  invoke("delete_backup", { id, name });

export const restoreBackup = (id: string, name: string): Promise<void> =>
  invoke("restore_backup", { id, name });

// Server properties
export const getServerProperties = (id: string): Promise<PropertyEntry[]> =>
  invoke("get_server_properties", { id });

export const saveServerProperties = (id: string, props: PropertyEntry[]): Promise<void> =>
  invoke("save_server_properties", { id, props });

// Player lists
export const getPlayerList = (id: string, listType: string): Promise<PlayerListEntry[]> =>
  invoke("get_player_list", { id, listType });

export const addToPlayerList = (id: string, listType: string, username: string): Promise<void> =>
  invoke("add_to_player_list", { id, listType, username });

export const removeFromPlayerList = (id: string, listType: string, uuid: string): Promise<void> =>
  invoke("remove_from_player_list", { id, listType, uuid });

// Scheduled tasks
export const getScheduledTasks = (id: string): Promise<ScheduledTask[]> =>
  invoke("get_scheduled_tasks", { id });

export const addScheduledTask = (id: string, task: Omit<ScheduledTask, "id" | "last_run">): Promise<ScheduledTask> =>
  invoke("add_scheduled_task", { id, task: { ...task, id: "", last_run: null } });

export const updateScheduledTask = (id: string, task: ScheduledTask): Promise<void> =>
  invoke("update_scheduled_task", { id, task });

export const removeScheduledTask = (id: string, taskId: string): Promise<void> =>
  invoke("remove_scheduled_task", { id, taskId });
