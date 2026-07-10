'use client';
import React, { useEffect, useState } from "react";
import { assets } from "@/assets/assets";
import Image from "next/image";
import { useAppContext } from "@/context/AppContext";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import Loading from "@/components/Loading";
import OrderTimeline from "@/components/OrderTimeline";
import { api } from "@/lib/api";

const STATUS_STYLES = {
    pending: 'bg-gray-100 text-gray-700',
    paid: 'bg-blue-100 text-blue-700',
    processing: 'bg-yellow-100 text-yellow-700',
    shipped: 'bg-purple-100 text-purple-700',
    out_for_delivery: 'bg-indigo-100 text-indigo-700',
    delivered: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    refunded: 'bg-red-100 text-red-700',
};

const formatStatus = (status) => (status || '').replace(/_/g, ' ');

const MyOrders = () => {

    const { currency } = useAppContext();

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchOrders = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/api/orders');
            setOrders(res?.data?.orders ?? []);
        } catch (err) {
            setError(err.message || 'Failed to load your orders');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchOrders();
    }, []);

    return (
        <>
            <Navbar />
            <div className="flex flex-col justify-between px-6 md:px-16 lg:px-32 py-6 min-h-screen">
                <div className="space-y-5">
                    <h2 className="text-lg font-medium mt-6">My Orders</h2>
                    {loading ? <Loading /> : error ? (
                        <div className="flex flex-col items-center gap-4 py-16">
                            <p className="text-gray-500">{error}</p>
                            <button onClick={fetchOrders} className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition">
                                Retry
                            </button>
                        </div>
                    ) : orders.length === 0 ? (
                        <p className="text-gray-500 text-center py-16">You haven&apos;t placed any orders yet.</p>
                    ) : (<div className="max-w-5xl border-t border-gray-300 text-sm">
                        {orders.map((order) => (
                            <div key={order.id} className="flex flex-col gap-5 p-5 border-b border-gray-300">
                                <div className="flex flex-col md:flex-row gap-5 justify-between">
                                    <div className="flex-1 flex gap-5 max-w-80">
                                        <Image
                                            className="max-w-16 max-h-16 object-cover"
                                            src={assets.box_icon}
                                            alt="box_icon"
                                        />
                                        <p className="flex flex-col gap-3">
                                            <span className="font-medium text-base">
                                                {(order.items ?? []).map((item) => `${item.product?.name ?? 'Product'} x ${item.quantity}`).join(", ")}
                                            </span>
                                            <span>Items : {(order.items ?? []).length}</span>
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-2 items-start md:items-end">
                                        <span className={`inline-block px-3 py-1 rounded-full text-xs capitalize whitespace-nowrap ${STATUS_STYLES[order.status] || 'bg-gray-100 text-gray-700'}`}>
                                            {formatStatus(order.status)}
                                        </span>
                                        <p className="font-medium">{currency}{order.amount}</p>
                                        <p className="text-gray-500">{order.created_at ? new Date(order.created_at).toLocaleDateString() : ''}</p>
                                    </div>
                                </div>
                                <OrderTimeline events={order.events} status={order.status} />
                            </div>
                        ))}
                    </div>)}
                </div>
            </div>
            <Footer />
        </>
    );
};

export default MyOrders;
