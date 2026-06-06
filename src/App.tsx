import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./App.css";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import ServerView from "./pages/ServerView";
import Settings from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <Sidebar />
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            backgroundColor: "var(--color-surface-0)",
          }}
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/server/:id" element={<ServerView />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
