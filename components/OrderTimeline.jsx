'use client'
import React from "react";

// Human-friendly labels for each order status.
const STATUS_META = {
  pending: { label: "Order Placed", hint: "Awaiting payment" },
  paid: { label: "Payment Confirmed", hint: "We received your payment" },
  processing: { label: "Processing", hint: "Preparing your order" },
  shipped: { label: "Shipped", hint: "On the way to the courier" },
  out_for_delivery: { label: "Out for Delivery", hint: "Arriving soon" },
  delivered: { label: "Delivered", hint: "Order completed" },
  cancelled: { label: "Cancelled", hint: "Order was cancelled" },
  refunded: { label: "Refunded", hint: "Amount refunded" },
};

// The happy-path fulfilment track.
const HAPPY_PATH = ["pending", "paid", "processing", "shipped", "out_for_delivery", "delivered"];
// When an order is cancelled/refunded it leaves the happy path after processing.
const CANCELLED_PATH = ["pending", "paid", "processing", "cancelled", "refunded"];

const formatWhen = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

const OrderTimeline = ({ events = [], status }) => {
  const isCancelledBranch = status === "cancelled" || status === "refunded";
  const steps = isCancelledBranch ? CANCELLED_PATH : HAPPY_PATH;
  const currentIndex = steps.indexOf(status);

  // Latest event per status → gives us the timestamp/note to show on a node.
  const eventByStatus = {};
  for (const event of events) {
    if (event && event.status) {
      eventByStatus[event.status] = event;
    }
  }

  return (
    <ol className="relative border-l border-gray-200 ml-3 my-2">
      {steps.map((step, index) => {
        const meta = STATUS_META[step] || { label: step, hint: "" };
        const event = eventByStatus[step];
        const isDone = currentIndex >= 0 && index < currentIndex;
        const isCurrent = index === currentIndex;
        const isCancelStep = step === "cancelled" || step === "refunded";

        const dotClass = isCurrent
          ? isCancelStep
            ? "bg-red-600 ring-4 ring-red-100"
            : "bg-orange-600 ring-4 ring-orange-100"
          : isDone
            ? "bg-orange-600"
            : "bg-gray-300";

        const titleClass = isCurrent
          ? isCancelStep
            ? "text-red-700"
            : "text-orange-700"
          : isDone
            ? "text-gray-800"
            : "text-gray-400";

        return (
          <li key={step} className="mb-6 ml-6">
            <span
              className={`absolute -left-[9px] flex items-center justify-center w-4 h-4 rounded-full ${dotClass}`}
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <h3 className={`text-sm font-medium ${titleClass}`}>{meta.label}</h3>
              <p className="text-xs text-gray-500">{event?.note || meta.hint}</p>
              {event?.created_at && (
                <time className="text-xs text-gray-400 mt-0.5">{formatWhen(event.created_at)}</time>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default OrderTimeline;
