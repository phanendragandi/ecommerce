'use client'
import { useAppContext } from "@/context/AppContext";
import { api } from "@/lib/api";
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

// Load Razorpay Checkout.js once and reuse it thereafter.
function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Razorpay is only available in the browser"));
      return;
    }
    if (window.Razorpay) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(script);
  });
}

const OrderSummary = () => {

  // Consume the context defensively — AppContext is owned by another agent,
  // so every optional method/field is guarded.
  const ctx = useAppContext() || {};
  const {
    currency,
    router,
    getCartCount,
    getCartAmount,
    cartItems,
    addresses,
    userData,
    user,
    flushCart,
    clearCart,
  } = ctx;

  const [selectedAddress, setSelectedAddress] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [userAddresses, setUserAddresses] = useState([]);
  const [isPlacing, setIsPlacing] = useState(false);

  const fetchUserAddresses = async () => {
    // Prefer addresses already loaded in context; otherwise fetch from the API.
    if (Array.isArray(addresses) && addresses.length > 0) {
      setUserAddresses(addresses);
      return;
    }
    try {
      const res = await api.get("/api/addresses");
      setUserAddresses(res?.data?.addresses ?? []);
    } catch {
      // Not logged in / no addresses yet — leave the list empty.
      setUserAddresses([]);
    }
  };

  const handleAddressSelect = (address) => {
    setSelectedAddress(address);
    setIsDropdownOpen(false);
  };

  // Address rows come from the API as snake_case; tolerate camelCase too.
  const addressLabel = (address) => {
    const name = address?.full_name ?? address?.fullName ?? "";
    return `${name}, ${address?.area}, ${address?.city}, ${address?.state}`;
  };

  const createOrder = async () => {
    if (isPlacing) return;

    if (!selectedAddress) {
      toast.error("Please select a delivery address");
      return;
    }

    // cartItems is a { productId: quantity } map in context.
    const items = Object.entries(cartItems || {})
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([product_id, quantity]) => ({ product_id, quantity: Number(quantity) }));

    if (items.length === 0) {
      toast.error("Your cart is empty");
      return;
    }

    setIsPlacing(true);
    try {
      // Flush any pending cart writes so the server sees the latest cart.
      if (typeof flushCart === "function") {
        await flushCart();
      }

      const addressId = selectedAddress.id ?? selectedAddress._id;

      // Server computes the amount from DB prices — we never send prices.
      const res = await api.post("/api/orders/checkout", {
        address_id: addressId,
        items,
      });
      const { orderId, rzpOrderId, amount, currency: cur, keyId } = res.data;

      await loadRazorpayScript();

      const prefillUser = userData || user || {};
      const options = {
        key: keyId,
        order_id: rzpOrderId,
        amount,
        currency: cur,
        name: "QuickCart",
        description: `Order ${orderId}`,
        prefill: {
          name: prefillUser.name ?? "",
          email: prefillUser.email ?? "",
        },
        theme: { color: "#ea580c" },
        // The browser handler is UX only — the webhook is the source of truth.
        // We still confirm via verify (and could poll) before celebrating.
        handler: async (response) => {
          try {
            await api.post("/api/payments/verify", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            if (typeof clearCart === "function") {
              clearCart();
            }
            router.push("/order-placed");
          } catch (err) {
            toast.error(err?.message || "We could not confirm your payment");
          }
        },
        modal: {
          // User closed the sheet: the order stays pending — offer a retry.
          ondismiss: () => {
            toast("Payment cancelled. Your order is saved — you can retry.");
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (response) => {
        toast.error(response?.error?.description || "Payment failed. Please try again.");
      });
      rzp.open();
    } catch (err) {
      toast.error(err?.message || "Could not start checkout");
    } finally {
      setIsPlacing(false);
    }
  };

  useEffect(() => {
    fetchUserAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses]);

  return (
    <div className="w-full md:w-96 bg-gray-500/5 p-5">
      <h2 className="text-xl md:text-2xl font-medium text-gray-700">
        Order Summary
      </h2>
      <hr className="border-gray-500/30 my-5" />
      <div className="space-y-6">
        <div>
          <label className="text-base font-medium uppercase text-gray-600 block mb-2">
            Select Address
          </label>
          <div className="relative inline-block w-full text-sm border">
            <button
              className="peer w-full text-left px-4 pr-2 py-2 bg-white text-gray-700 focus:outline-none"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <span>
                {selectedAddress
                  ? addressLabel(selectedAddress)
                  : "Select Address"}
              </span>
              <svg className={`w-5 h-5 inline float-right transition-transform duration-200 ${isDropdownOpen ? "rotate-0" : "-rotate-90"}`}
                xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="#6B7280"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isDropdownOpen && (
              <ul className="absolute w-full bg-white border shadow-md mt-1 z-10 py-1.5">
                {userAddresses.map((address, index) => (
                  <li
                    key={address.id ?? address._id ?? index}
                    className="px-4 py-2 hover:bg-gray-500/10 cursor-pointer"
                    onClick={() => handleAddressSelect(address)}
                  >
                    {addressLabel(address)}
                  </li>
                ))}
                <li
                  onClick={() => router.push("/add-address")}
                  className="px-4 py-2 hover:bg-gray-500/10 cursor-pointer text-center"
                >
                  + Add New Address
                </li>
              </ul>
            )}
          </div>
        </div>

        <div>
          <label className="text-base font-medium uppercase text-gray-600 block mb-2">
            Promo Code
          </label>
          <div className="flex flex-col items-start gap-3">
            <input
              type="text"
              placeholder="Enter promo code"
              className="flex-grow w-full outline-none p-2.5 text-gray-600 border"
            />
            <button className="bg-orange-600 text-white px-9 py-2 hover:bg-orange-700">
              Apply
            </button>
          </div>
        </div>

        <hr className="border-gray-500/30 my-5" />

        <div className="space-y-4">
          <div className="flex justify-between text-base font-medium">
            <p className="uppercase text-gray-600">Items {getCartCount()}</p>
            <p className="text-gray-800">{currency}{getCartAmount()}</p>
          </div>
          <div className="flex justify-between">
            <p className="text-gray-600">Shipping Fee</p>
            <p className="font-medium text-gray-800">Free</p>
          </div>
          <div className="flex justify-between">
            <p className="text-gray-600">Tax (2%)</p>
            <p className="font-medium text-gray-800">{currency}{Math.floor(getCartAmount() * 0.02)}</p>
          </div>
          <div className="flex justify-between text-lg md:text-xl font-medium border-t pt-3">
            <p>Total</p>
            <p>{currency}{getCartAmount() + Math.floor(getCartAmount() * 0.02)}</p>
          </div>
        </div>
      </div>

      <button onClick={createOrder} disabled={isPlacing} className="w-full bg-orange-600 text-white py-3 mt-5 hover:bg-orange-700 disabled:opacity-60">
        {isPlacing ? "Processing..." : "Place Order"}
      </button>
    </div>
  );
};

export default OrderSummary;
