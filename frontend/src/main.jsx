import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { AuthProvider } from "./lib/auth";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster theme="dark" position="bottom-right" toastOptions={{ className: "font-sans" }} />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
