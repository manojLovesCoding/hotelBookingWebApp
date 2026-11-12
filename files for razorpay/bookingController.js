
import transporter from "../configs/nodemailer.js";
import Booking from "../models/Booking.js";
import Hotel from "../models/Hotel.js";
import Room from "../models/Room.js";

import Razorpay from "razorpay";
import crypto from "crypto";

// Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Check room availability
const checkAvailability = async ({
  checkInDate,
  checkOutDate,
  room,
}) => {
  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  if (
    !room ||
    Number.isNaN(checkIn.getTime()) ||
    Number.isNaN(checkOut.getTime()) ||
    checkIn >= checkOut
  ) {
    throw new Error("Invalid room or booking dates");
  }

  const bookings = await Booking.find({
    room,
    status: { $ne: "cancelled" },
    checkInDate: { $lt: checkOut },
    checkOutDate: { $gt: checkIn },
  });

  return bookings.length === 0;
};

// Send booking confirmation email
const sendBookingEmail = async (booking, roomData, user) => {
  try {
    if (!user?.email) {
      console.log("Booking email skipped: user email not available");
      return;
    }

    const mailOptions = {
      from: process.env.SENDER_EMAIL,
      to: user.email,
      subject: "Hotel Booking Details",
      html: `
        <h2>Your Booking Details</h2>
        <p>Dear ${user.username || "Customer"},</p>
        <p>Thank you for your booking!</p>

        <ul>
          <li><strong>Booking ID:</strong> ${booking._id}</li>
          <li><strong>Hotel Name:</strong> ${roomData.hotel.name}</li>
          <li><strong>Location:</strong> ${roomData.hotel.address}</li>
          <li><strong>Check-In:</strong> ${booking.checkInDate.toDateString()}</li>
          <li><strong>Check-Out:</strong> ${booking.checkOutDate.toDateString()}</li>
          <li><strong>Guests:</strong> ${booking.guests}</li>
          <li><strong>Booking Amount:</strong> ₹${booking.totalPrice}</li>
          <li><strong>Payment Method:</strong> ${booking.paymentMethod}</li>
        </ul>

        <p>We look forward to welcoming you!</p>
      `,
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    // Email failure should not undo a successful booking/payment.
    console.error("Booking email error:", error.message);
  }
};

// API to check room availability
// POST /api/bookings/check-availability
export const checkAvailabilityAPI = async (req, res) => {
  try {
    const { room, checkInDate, checkOutDate } = req.body;

    const isAvailable = await checkAvailability({
      room,
      checkInDate,
      checkOutDate,
    });

    return res.json({
      success: true,
      isAvailable,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Create Pay At Hotel booking
// POST /api/bookings/book
export const createBooking = async (req, res) => {
  try {
    const {
      room,
      checkInDate,
      checkOutDate,
      guests,
      paymentMethod,
    } = req.body;

    const user = req.user._id;

    // This endpoint is only for Pay At Hotel bookings.
    if (paymentMethod && paymentMethod !== "Pay At Hotel") {
      return res.status(400).json({
        success: false,
        message: "Use online payment for Razorpay bookings",
      });
    }

    if (!guests || Number(guests) < 1) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid number of guests",
      });
    }

    const isAvailable = await checkAvailability({
      room,
      checkInDate,
      checkOutDate,
    });

    if (!isAvailable) {
      return res.status(409).json({
        success: false,
        message: "Room is not available",
      });
    }

    const roomData = await Room.findById(room).populate("hotel");

    if (!roomData || !roomData.hotel) {
      return res.status(404).json({
        success: false,
        message: "Room or hotel not found",
      });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    const nights = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    if (nights <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking dates",
      });
    }

    const totalPrice = Number(roomData.pricePerNight) * nights;

    if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid room price",
      });
    }

    const booking = await Booking.create({
      user,
      room,
      hotel: roomData.hotel._id,
      guests: Number(guests),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      totalPrice,
      paymentMethod: "Pay At Hotel",
      isPaid: false,
    });

    await sendBookingEmail(booking, roomData, req.user);

    return res.json({
      success: true,
      message: "Booking created successfully",
      booking,
    });
  } catch (error) {
    console.error("Create booking error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create booking",
    });
  }
};

// Get all bookings for a user
// GET /api/bookings/user
export const getUserBookings = async (req, res) => {
  try {
    const user = req.user._id;

    const bookings = await Booking.find({ user })
      .populate("room hotel")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      bookings,
    });
  } catch (error) {
    console.error("Get user bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
};

// Get all bookings for a hotel owner
// GET /api/bookings/hotel
export const getHotelBookings = async (req, res) => {
  try {
    const hotel = await Hotel.findOne({
      owner: req.auth().userId,
    });

    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: "No Hotel found",
      });
    }

    const bookings = await Booking.find({ hotel: hotel._id })
      .populate("room hotel user")
      .sort({ createdAt: -1 });

    const totalBookings = bookings.length;

    const totalRevenue = bookings.reduce(
      (acc, booking) => acc + booking.totalPrice,
      0
    );

    return res.json({
      success: true,
      dashboardData: {
        totalBookings,
        totalRevenue,
        bookings,
      },
    });
  } catch (error) {
    console.error("Get hotel bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
};

// Create Razorpay order
// POST /api/bookings/razorpay-order
export const createRazorpayOrder = async (req, res) => {
  try {
    const {
      room,
      checkInDate,
      checkOutDate,
      guests,
    } = req.body;

    if (!guests || Number(guests) < 1) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid number of guests",
      });
    }

    const isAvailable = await checkAvailability({
      room,
      checkInDate,
      checkOutDate,
    });

    if (!isAvailable) {
      return res.status(409).json({
        success: false,
        message: "Room is not available",
      });
    }

    const roomData = await Room.findById(room).populate("hotel");

    if (!roomData || !roomData.hotel) {
      return res.status(404).json({
        success: false,
        message: "Room or hotel not found",
      });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    const nights = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    if (nights <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking dates",
      });
    }

    // Calculate amount on the server, never trust frontend price.
    const totalPrice = Number(roomData.pricePerNight) * nights;

    if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid room price",
      });
    }

    // Razorpay expects amount in paise.
    const amountInPaise = Math.round(totalPrice * 100);

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `hotel_${Date.now()}`,
      notes: {
        userId: String(req.user._id),
        roomId: String(roomData._id),
        hotelId: String(roomData.hotel._id),
        checkInDate: checkIn.toISOString(),
        checkOutDate: checkOut.toISOString(),
        guests: String(guests),
      },
    });

    return res.json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID,
      hotelName: roomData.hotel.name,
    });
  } catch (error) {
    console.error("Razorpay order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Unable to create Razorpay order",
    });
  }
};

// Verify Razorpay payment and create booking
// POST /api/bookings/verify-payment
export const verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing Razorpay payment details",
      });
    }

    // Verify that the order belongs to the logged-in user.
    const order = await razorpay.orders.fetch(razorpay_order_id);

    if (
      !order ||
      String(order.notes?.userId) !== String(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Invalid payment order",
      });
    }

    // Verify Razorpay signature.
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const signatureBuffer = Buffer.from(razorpay_signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    const signatureIsValid =
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!signatureIsValid) {
      return res.status(400).json({
        success: false,
        message: "Payment signature verification failed",
      });
    }

    // Fetch payment directly from Razorpay.
    const payment = await razorpay.payments.fetch(
      razorpay_payment_id
    );

    if (
      payment.order_id !== razorpay_order_id ||
      payment.status !== "captured" ||
      payment.amount !== order.amount ||
      payment.currency !== "INR"
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment has not been captured successfully",
      });
    }

    // Prevent duplicate bookings if the callback is submitted again.
    const existingBooking = await Booking.findOne({
      razorpayPaymentId: razorpay_payment_id,
    });

    if (existingBooking) {
      return res.json({
        success: true,
        message: "Payment already verified",
        booking: existingBooking,
      });
    }

    const notes = order.notes;

    // Recheck availability before creating the paid booking.
    const isAvailable = await checkAvailability({
      room: notes.roomId,
      checkInDate: notes.checkInDate,
      checkOutDate: notes.checkOutDate,
    });

    if (!isAvailable) {
      return res.status(409).json({
        success: false,
        message:
          "Payment was received, but the room is no longer available. Please contact support.",
        paymentReceived: true,
        razorpayPaymentId: razorpay_payment_id,
      });
    }

    const roomData = await Room.findById(notes.roomId).populate("hotel");

    if (!roomData || !roomData.hotel) {
      return res.status(404).json({
        success: false,
        message: "Room or hotel not found",
        paymentReceived: true,
      });
    }

    // Recalculate expected amount from current database price.
    const checkIn = new Date(notes.checkInDate);
    const checkOut = new Date(notes.checkOutDate);

    const nights = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    const expectedAmount = Math.round(
      Number(roomData.pricePerNight) * nights * 100
    );

    if (
      nights <= 0 ||
      expectedAmount !== order.amount ||
      String(roomData.hotel._id) !== String(notes.hotelId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Booking amount or details do not match",
        paymentReceived: true,
      });
    }

    const booking = await Booking.create({
      user: req.user._id,
      room: roomData._id,
      hotel: roomData.hotel._id,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guests: Number(notes.guests),
      totalPrice: expectedAmount / 100,
      paymentMethod: "Razorpay",
      isPaid: true,
      status: "confirmed",
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
    });

    await sendBookingEmail(booking, roomData, req.user);

    return res.json({
      success: true,
      message: "Payment successful and booking confirmed",
      booking,
    });
  } catch (error) {
    console.error("Razorpay verification error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Payment verification failed",
    });
  }
};
