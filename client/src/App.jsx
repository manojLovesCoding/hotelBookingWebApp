import React from "react";
import Navbar from "./components/Navbar";
import { Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Footer from "./components/Footer";
import AllRooms from "./pages/AllRooms";
<<<<<<< HEAD
=======
import RoomDetails from "./pages/RoomDetails";
>>>>>>> e7c2791 (feat(room-details): add room details page with images, amenities, booking form, and host info)

const App = () => {
  const isOwnerAuth = useLocation().pathname.includes("owner");
  return (
    <div>
      {!isOwnerAuth && <Navbar />}
      <div className="min-h-[70vh]">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/rooms" element={<AllRooms />} />
<<<<<<< HEAD
=======
           <Route path="/rooms/:id" element={<RoomDetails />} />
>>>>>>> e7c2791 (feat(room-details): add room details page with images, amenities, booking form, and host info)
        </Routes>
      </div>
      <Footer/>
    </div>
  );
};

export default App;
