mod commands;
mod models;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(data_dir.join("servers"))
                .expect("failed to create servers dir");
            app.manage(AppState::new(data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_minecraft_versions,
            commands::list_servers,
            commands::create_server,
            commands::delete_server,
            commands::start_server,
            commands::stop_server,
            commands::restart_server,
            commands::send_command,
            commands::get_server_status,
            commands::query_players,
            commands::list_server_files,
            commands::read_server_file,
            commands::write_server_file,
            commands::delete_server_file,
            commands::open_server_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
