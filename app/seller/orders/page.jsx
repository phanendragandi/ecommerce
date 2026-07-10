'use client';
import React, { useEffect, useState } from "react";
import { assets } from "@/assets/assets";
import Image from "next/image";
import { useAppContext } from "@/context/AppContext";
import Footer from "@/components/seller/Footer";
import Loading from "@/components/Loading";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

const STATUS_OPTIONS = ['pending', 'paid', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'];

const Orders = () => {

    const { currency } = useAppContext();

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [updatingId, setUpdatingId] = useState(null);

    const fetchSellerOrders = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/api/seller/orders');
            setOrders(res?.data?.orders ?? []);
        } catch (err) {
            setError(err.message || 'Failed to load orders');
        } finally {
            setLoading(false);
        }
    }

    const handleStatusChange = async (orderId, status) => {
        const previous = orders.find((o) => o.id === orderId)?.status;
        setUpdatingId(orderId);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
        try {
            await api.patch(`/api/seller/orders/${orderId}/status`, { status });
            toast.success('Order status updated');
        } catch (err) {
            toast.error(err.message || 'Failed to update order status');
            setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: previous } : o)));
        } finally {
            setUpdatingId(null);
        }
    }

    useEffect(() => {
        fetchSellerOrders();
    }, []);

    return (
        <div className="flex-1 h-screen overflow-scroll flex flex-col justify-between text-sm">
            {loading ? <Loading /> : error ? (
                <div className="md:p-10 p-4 flex flex-col items-center gap-4 py-20">
                    <p className="text-gray-500">{error}</p>
                    <button onClick={fetchSellerOrders} className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition">
                        Retry
                    </button>
                </div>
            ) : orders.length === 0 ? (
                <div className="md:p-10 p-4 space-y-5">
                    <h2 className="text-lg font-medium">Orders</h2>
                    <p className="text-gray-500 text-center py-16">No orders yet.</p>
                </div>
            ) : <div className="md:p-10 p-4 space-y-5">
                <h2 className="text-lg font-medium">Orders</h2>
                <div className="max-w-4xl rounded-md">
                    {orders.map((order) => (
                        <div key={order.id} className="flex flex-col md:flex-row gap-5 justify-between p-5 border-t border-gray-300">
                            <div className="flex-1 flex gap-5 max-w-80">
                                <Image
                                    className="max-w-16 max-h-16 object-cover"
                                    src={assets.box_icon}
                                    alt="box_icon"
                                />
                                <p className="flex flex-col gap-3">
                                    <span className="font-medium">
                                        {(order.items ?? []).map((item) => `${item.product?.name ?? 'Product'} x ${item.quantity}`).join(", ")}
                                    </span>
                                    <span>Items : {(order.items ?? []).length}</span>
                                </p>
                            </div>
                            <p className="font-medium my-auto">{currency}{order.amount}</p>
                            <div>
                                <p className="flex flex-col">
                                    <span>Date : {order.created_at ? new Date(order.created_at).toLocaleDateString() : ''}</span>
                                    <span>Payment : {order.payment_status}</span>
                                </p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-xs text-gray-500" htmlFor={`status-${order.id}`}>Status</label>
                                <select
                                    id={`status-${order.id}`}
                                    value={order.status}
                                    disabled={updatingId === order.id}
                                    onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                    className="border border-gray-300 rounded px-2 py-1.5 text-sm capitalize disabled:opacity-60"
                                >
                                    {STATUS_OPTIONS.map((status) => (
                                        <option key={status} value={status} className="capitalize">{status.replace(/_/g, ' ')}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    ))}
                </div>
            </div>}
            <Footer />
        </div>
    );
};

export default Orders;
