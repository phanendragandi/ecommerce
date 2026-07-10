'use client'
import { assets } from "@/assets/assets";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

// Mirrors server/src/validators/addresses.ts (addressCreateSchema) so the
// user gets instant feedback before the request round-trips.
const PHONE_RE = /^[6-9]\d{9}$/;
const PINCODE_RE = /^\d{6}$/;

const validateAddress = (address) => {
    const full_name = address.full_name.trim();
    const phone = address.phone.trim();
    const pincode = address.pincode.trim();
    const area = address.area.trim();
    const city = address.city.trim();
    const state = address.state.trim();

    if (!full_name || full_name.length > 120) {
        return 'Full name is required (max 120 characters)';
    }
    if (!PHONE_RE.test(phone)) {
        return 'Phone must be a valid 10-digit India phone number';
    }
    if (!PINCODE_RE.test(pincode)) {
        return 'Pincode must be a 6-digit code';
    }
    if (!area || area.length > 200) {
        return 'Address (area) is required (max 200 characters)';
    }
    if (!city || city.length > 100) {
        return 'City is required (max 100 characters)';
    }
    if (!state || state.length > 100) {
        return 'State is required (max 100 characters)';
    }
    return null;
};

const AddAddress = () => {

    const router = useRouter();

    const [address, setAddress] = useState({
        full_name: '',
        phone: '',
        pincode: '',
        area: '',
        city: '',
        state: '',
    })
    const [submitting, setSubmitting] = useState(false);

    const onSubmitHandler = async (e) => {
        e.preventDefault();

        const validationError = validateAddress(address);
        if (validationError) {
            toast.error(validationError);
            return;
        }

        setSubmitting(true);
        try {
            await api.post('/api/addresses', {
                full_name: address.full_name.trim(),
                phone: address.phone.trim(),
                pincode: address.pincode.trim(),
                area: address.area.trim(),
                city: address.city.trim(),
                state: address.state.trim(),
            });
            toast.success('Address saved');
            router.push('/cart');
        } catch (err) {
            toast.error(err.message || 'Failed to save address');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <>
            <Navbar />
            <div className="px-6 md:px-16 lg:px-32 py-16 flex flex-col md:flex-row justify-between">
                <form onSubmit={onSubmitHandler} className="w-full">
                    <p className="text-2xl md:text-3xl text-gray-500">
                        Add Shipping <span className="font-semibold text-orange-600">Address</span>
                    </p>
                    <div className="space-y-3 max-w-sm mt-10">
                        <input
                            className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500"
                            type="text"
                            placeholder="Full name"
                            onChange={(e) => setAddress({ ...address, full_name: e.target.value })}
                            value={address.full_name}
                        />
                        <input
                            className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500"
                            type="text"
                            placeholder="Phone number"
                            onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                            value={address.phone}
                        />
                        <input
                            className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500"
                            type="text"
                            placeholder="Pin code"
                            onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                            value={address.pincode}
                        />
                        <textarea
                            className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500 resize-none"
                            rows={4}
                            placeholder="Address (Area and Street)"
                            onChange={(e) => setAddress({ ...address, area: e.target.value })}
                            value={address.area}
                        ></textarea>
                        <div className="flex space-x-3">
                            <input
                                className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500"
                                type="text"
                                placeholder="City/District/Town"
                                onChange={(e) => setAddress({ ...address, city: e.target.value })}
                                value={address.city}
                            />
                            <input
                                className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500"
                                type="text"
                                placeholder="State"
                                onChange={(e) => setAddress({ ...address, state: e.target.value })}
                                value={address.state}
                            />
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="max-w-sm w-full mt-6 bg-orange-600 text-white py-3 hover:bg-orange-700 uppercase disabled:opacity-60"
                    >
                        {submitting ? 'Saving...' : 'Save address'}
                    </button>
                </form>
                <Image
                    className="md:mr-16 mt-16 md:mt-0"
                    src={assets.my_location_image}
                    alt="my_location_image"
                />
            </div>
            <Footer />
        </>
    );
};

export default AddAddress;
