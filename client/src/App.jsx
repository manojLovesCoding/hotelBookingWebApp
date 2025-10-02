import React from "react";
import Navbar from "./components/Navbar";
import { useLocation } from "react-router-dom";

const App = () => {
  const isOwnerAuth = useLocation().pathname.includes("owner");
  return <div>{!isOwnerAuth && <Navbar />}</div>;
};

export default App;
