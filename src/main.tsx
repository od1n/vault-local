import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickSearch } from "./components/QuickSearch";

// La ventana de búsqueda rápida carga el mismo index.html con "#quick"
const isQuick = window.location.hash === "#quick";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isQuick ? <QuickSearch /> : <App />}</React.StrictMode>
);
