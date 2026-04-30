import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Wafers from "./pages/Wafers";
import Data from "./pages/Data";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="wafers" element={<Wafers />} />
          <Route path="data" element={<Data />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
