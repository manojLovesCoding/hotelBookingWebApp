
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  assets,
  facilityIcons,
  roomCommonData,
} from "../assets/assets";
import StarRating from "../components/StarRating";
import { useAppContext } from "../context/AppContext";
import toast from "react-hot-toast";

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);

    document.body.appendChild(script);
  });
};

const RoomDetails = () => {
  const { id } = useParams();

  const { rooms, getToken, axios, navigate } = useAppContext();

  const [room, setRoom] = useState(null);
  const [mainImage, setMainImage] = useState(null);

  const [checkInDate, setCheckInDate] = useState("");
  const [checkOutDate, setCheckOutDate] = useState("");
  const [guests, setGuests] = useState(1);

  const [isAvailable, setIsAvailable] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Pay At Hotel");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const selectedRoom = rooms.find((item) => item._id === id);

    if (selectedRoom) {
      setRoom(selectedRoom);
      setMainImage(selectedRoom.images?.[0] || null);
    }
  }, [rooms, id]);

  // Check room availability
  const checkAvailability = async () => {
    try {
      if (!checkInDate || !checkOutDate) {
        toast.error("Please select check-in and check-out dates");
        return false;
      }

      if (new Date(checkInDate) >= new Date(checkOutDate)) {
        toast.error("Check-In Date should be less than Check-Out Date");
        return false;
      }

      const { data } = await axios.post(
        "/api/bookings/check-availability",
        {
          room: id,
          checkInDate,
          checkOutDate,
        }
      );

      if (data.success && data.isAvailable) {
        setIsAvailable(true);
        toast.success("Room is Available");
        return true;
      }

      setIsAvailable(false);
      toast.error(data.message || "Room is not available");
      return false;
    } catch (error) {
      setIsAvailable(false);
      toast.error(
        error.response?.data?.message || error.message
      );
      return false;
    }
  };

  // Create Pay At Hotel booking
  const bookAtHotel = async () => {
    const token = await getToken();

    const { data } = await axios.post(
      "/api/bookings/book",
      {
        room: id,
        checkInDate,
        checkOutDate,
        guests: Number(guests),
        paymentMethod: "Pay At Hotel",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (data.success) {
      toast.success(data.message);
      navigate("/my-bookings");
      window.scrollTo(0, 0);
    } else {
      toast.error(data.message);
    }
  };

  // Create Razorpay order and open Checkout
  const payOnline = async () => {
    const scriptLoaded = await loadRazorpayScript();

    if (!scriptLoaded) {
      toast.error("Unable to load Razorpay. Please try again.");
      return;
    }

    const token = await getToken();

    // Create order on backend
    const { data } = await axios.post(
      "/api/bookings/razorpay-order",
      {
        room: id,
        checkInDate,
        checkOutDate,
        guests: Number(guests),
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!data.success) {
      toast.error(data.message || "Unable to create payment order");
      return;
    }

    const options = {
      key: data.key,
      amount: data.order.amount,
      currency: data.order.currency,
      name: "Hotel Booking",
      description: `Booking at ${data.hotelName}`,
      order_id: data.order.id,

      handler: async (response) => {
        try {
          const { data: verifyData } = await axios.post(
            "/api/bookings/verify-payment",
            {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (verifyData.success) {
            toast.success(verifyData.message);
            navigate("/my-bookings");
            window.scrollTo(0, 0);
          } else {
            toast.error(
              verifyData.message || "Payment verification failed"
            );
          }
        } catch (error) {
          toast.error(
            error.response?.data?.message ||
              "Payment verification failed. Please contact support if money was deducted."
          );
        }
      },

      prefill: {
        name: "Guest",
      },

      theme: {
        color: "#2563eb",
      },

      modal: {
        ondismiss: () => {
          toast("Payment window closed");
        },
      },
    };

    const razorpayInstance = new window.Razorpay(options);

    razorpayInstance.on("payment.failed", (response) => {
      toast.error(
        response.error?.description || "Payment failed"
      );
    });

    razorpayInstance.open();
  };

  // Booking form submit
  const onSubmitHandler = async (e) => {
    e.preventDefault();

    if (isProcessing) return;

    if (!checkInDate || !checkOutDate) {
      toast.error("Please select your dates");
      return;
    }

    if (Number(guests) < 1) {
      toast.error("Please enter a valid number of guests");
      return;
    }

    if (new Date(checkInDate) >= new Date(checkOutDate)) {
      toast.error("Check-In Date should be less than Check-Out Date");
      return;
    }

    setIsProcessing(true);

    try {
      // Always check availability again before booking/payment.
      const available = await checkAvailability();

      if (!available) return;

      if (paymentMethod === "Pay At Hotel") {
        await bookAtHotel();
      } else {
        await payOnline();
      }
    } catch (error) {
      console.error("Booking error:", error);

      toast.error(
        error.response?.data?.message ||
          error.message ||
          "Something went wrong"
      );
    } finally {
      setIsProcessing(false);
    }
  };

  if (!room) return null;

  return (
    <div className="py-28 md:py-35 px-4 md:px-16 lg:px-24 xl:px-32">

      {/* Room title */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
        <h1 className="text-2xl md:text-4xl font-playfair">
          {room.hotel.name}
          <span className="font-inter text-sm">
            ({room.roomType})
          </span>
        </h1>

        <p className="text-xs font-inter py-1.5 px-3 text-white bg-orange-500 rounded-full">
          20% OFF
        </p>
      </div>

      {/* Rating */}
      <div className="flex items-center gap-1 mt-2">
        <StarRating />
        <p className="ml-2">200+ reviews</p>
      </div>

      {/* Address */}
      <div className="flex items-center gap-1 text-gray-500 mt-2">
        <img src={assets.locationIcon} alt="location" />
        <span>{room.hotel.address}</span>
      </div>

      {/* Room images */}
      <div className="flex flex-col lg:flex-row mt-6 gap-6">
        <div className="lg:w-1/2 w-full">
          <img
            src={mainImage}
            alt="room"
            className="w-full rounded-xl shadow-lg object-cover"
          />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:w-1/2 w-full">
          {room.images?.length > 1 &&
            room.images.map((image, index) => (
              <img
                onClick={() => setMainImage(image)}
                src={image}
                alt="room"
                key={index}
                className={`w-full rounded-xl shadow-md object-cover cursor-pointer ${
                  mainImage === image
                    ? "outline-3 outline-orange-500"
                    : ""
                }`}
              />
            ))}
        </div>
      </div>

      {/* Room highlights */}
      <div className="flex flex-col md:flex-row md:justify-between mt-10">
        <div className="flex flex-col">
          <h1 className="text-3xl md:text-4xl font-playfair">
            Experience Luxury Like Never Before
          </h1>

          <div className="flex flex-wrap items-center mt-3 mb-6 gap-4">
            {room.amenities?.map((item, index) => (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100"
                key={index}
              >
                <img
                  src={facilityIcons[item]}
                  alt={item}
                  className="w-5 h-5"
                />
                <p className="text-xs">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-2xl font-medium">
          ₹{room.pricePerNight}/night
        </p>
      </div>

      {/* Booking form */}
      <form
        onSubmit={onSubmitHandler}
        className="flex flex-col gap-6 bg-white shadow-[0px_0px_20px_rgba(0,0,0,0.15)] p-6 rounded-xl mx-auto mt-16 max-w-6xl"
      >
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-10 text-gray-500">

          {/* Check-in */}
          <div className="flex flex-col">
            <label htmlFor="checkInDate" className="font-medium">
              Check-In
            </label>

            <input
              onChange={(e) => {
                setCheckInDate(e.target.value);
                setIsAvailable(false);
              }}
              min={new Date().toISOString().split("T")[0]}
              value={checkInDate}
              type="date"
              id="checkInDate"
              className="w-full rounded border border-gray-300 px-3 py-2 mt-1.5 outline-none"
              required
            />
          </div>

          <div className="w-px h-15 bg-gray-300/70 max-md:hidden"></div>

          {/* Check-out */}
          <div className="flex flex-col">
            <label htmlFor="checkOutDate" className="font-medium">
              Check-Out
            </label>

            <input
              onChange={(e) => {
                setCheckOutDate(e.target.value);
                setIsAvailable(false);
              }}
              min={checkInDate || new Date().toISOString().split("T")[0]}
              disabled={!checkInDate}
              value={checkOutDate}
              type="date"
              id="checkOutDate"
              className="w-full rounded border border-gray-300 px-3 py-2 mt-1.5 outline-none"
              required
            />
          </div>

          <div className="w-px h-15 bg-gray-300/70 max-md:hidden"></div>

          {/* Guests */}
          <div className="flex flex-col">
            <label htmlFor="guests" className="font-medium">
              Guests
            </label>

            <input
              onChange={(e) => setGuests(e.target.value)}
              value={guests}
              min="1"
              type="number"
              id="guests"
              className="max-w-20 rounded border border-gray-300 px-3 py-2 mt-1.5 outline-none"
              required
            />
          </div>
        </div>

        {/* Payment method */}
        <div className="border-t border-gray-200 pt-5">
          <p className="font-medium text-gray-800 mb-3">
            Select Payment Method
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <label className="flex items-center gap-2 cursor-pointer border rounded-lg p-3">
              <input
                type="radio"
                name="paymentMethod"
                value="Pay At Hotel"
                checked={paymentMethod === "Pay At Hotel"}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
              <span>Pay At Hotel</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer border rounded-lg p-3">
              <input
                type="radio"
                name="paymentMethod"
                value="Razorpay"
                checked={paymentMethod === "Razorpay"}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
              <span>Pay Online (Razorpay)</span>
            </label>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isProcessing}
          className="bg-primary hover:bg-primary-dull active:scale-95 transition-all text-white rounded-md w-full md:w-auto md:px-16 py-3 md:py-4 text-base cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isProcessing
            ? "Processing..."
            : paymentMethod === "Razorpay"
            ? "Pay Now"
            : "Book Now"}
        </button>
      </form>

      {/* Common specifications */}
      <div className="mt-25 space-y-4">
        {roomCommonData.map((spec, index) => (
          <div key={index} className="flex items-start gap-2">
            <img src={spec.icon} className="w-6.5" alt="" />

            <div>
              <p className="text-base">{spec.title}</p>
              <p className="text-gray-500">{spec.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Room description */}
      <div className="max-w-3xl border-y border-gray-300 my-15 py-10 text-gray-500">
        <p>
          Guests will be allocated on the ground floor according to
          availability. You get a comfortable two-bedroom apartment
          with a true city feeling. The price quoted is for two guests.
          Please select the number of guests to get the exact price
          for your group.
        </p>
      </div>

      {/* Hosted by */}
      <div className="flex flex-col items-start gap-4">
        <div className="flex gap-4">
          <img
            src={room?.hotel?.owner?.image || assets.defaultHostImage}
            alt="host"
            className="h-14 w-14 md:h-18 md:w-18 rounded-full"
          />

          <div>
            <p className="text-lg md:text-xl">
              Hosted by {room?.hotel?.name || "Unknown"}
            </p>

            <div className="flex items-center mt-1">
              <StarRating />
              <p className="ml-2">200+ reviews</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="px-6 py-2.5 mt-4 rounded text-white bg-primary hover:bg-primary-dull transition-all cursor-pointer"
        >
          Contact Now
        </button>
      </div>
    </div>
  );
};

export default RoomDetails;
