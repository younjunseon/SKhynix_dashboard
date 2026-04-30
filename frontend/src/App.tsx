import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Wafers from "./pages/Wafers";
import Lots from "./pages/Lots";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="wafers" element={<Wafers />} />
          <Route path="lots" element={<Lots />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
