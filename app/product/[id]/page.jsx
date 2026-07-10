"use client"
import { useEffect, useState } from "react";
import { assets } from "@/assets/assets";
import ProductCard from "@/components/ProductCard";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Image from "next/image";
import { useParams } from "next/navigation";
import Loading from "@/components/Loading";
import { useAppContext } from "@/context/AppContext";
import { api } from "@/lib/api";
import React from "react";

// Same field mapping as context/AppContext.jsx — this page fetches the
// single product directly by id rather than waiting on the full catalog.
const normalizeProduct = (p) => ({
    _id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    price: p.price,
    offerPrice: p.offer_price ?? p.price,
    image: Array.isArray(p.images) && p.images.length > 0 ? p.images : [assets.upload_area],
    stock: typeof p.stock === 'number' ? p.stock : 0,
});

const Product = () => {

    const { id } = useParams();

    const { products, router, addToCart, currency } = useAppContext()

    const [mainImage, setMainImage] = useState(null);
    const [productData, setProductData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchProductData = async () => {
        setLoading(true);
        setError(null);
        setMainImage(null);
        try {
            const res = await api.get(`/api/products/${id}`, { auth: false });
            setProductData(normalizeProduct(res.data.product));
        } catch (err) {
            setProductData(null);
            setError(err.message || 'Failed to load product');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (id) fetchProductData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    if (loading) return <Loading />;

    if (error || !productData) {
        const notFound = /not found/i.test(error || '');
        return (
            <>
                <Navbar />
                <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
                    <p className="text-xl text-gray-500">{notFound ? 'Product not found' : error || 'Something went wrong'}</p>
                    <div className="flex items-center gap-3">
                        {!notFound && (
                            <button onClick={fetchProductData} className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition">
                                Retry
                            </button>
                        )}
                        <button onClick={() => router.push('/all-products')} className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition">
                            Back to all products
                        </button>
                    </div>
                </div>
                <Footer />
            </>
        );
    }

    return (<>
        <Navbar />
        <div className="px-6 md:px-16 lg:px-32 pt-14 space-y-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
                <div className="px-5 lg:px-16 xl:px-20">
                    <div className="rounded-lg overflow-hidden bg-gray-500/10 mb-4">
                        <Image
                            src={mainImage || productData.image[0]}
                            alt="alt"
                            className="w-full h-auto object-cover mix-blend-multiply"
                            width={1280}
                            height={720}
                        />
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                        {productData.image.map((image, index) => (
                            <div
                                key={index}
                                onClick={() => setMainImage(image)}
                                className="cursor-pointer rounded-lg overflow-hidden bg-gray-500/10"
                            >
                                <Image
                                    src={image}
                                    alt="alt"
                                    className="w-full h-auto object-cover mix-blend-multiply"
                                    width={1280}
                                    height={720}
                                />
                            </div>

                        ))}
                    </div>
                </div>

                <div className="flex flex-col">
                    <h1 className="text-3xl font-medium text-gray-800/90 mb-4">
                        {productData.name}
                    </h1>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-0.5">
                            <Image className="h-4 w-4" src={assets.star_icon} alt="star_icon" />
                            <Image className="h-4 w-4" src={assets.star_icon} alt="star_icon" />
                            <Image className="h-4 w-4" src={assets.star_icon} alt="star_icon" />
                            <Image className="h-4 w-4" src={assets.star_icon} alt="star_icon" />
                            <Image
                                className="h-4 w-4"
                                src={assets.star_dull_icon}
                                alt="star_dull_icon"
                            />
                        </div>
                        <p>(4.5)</p>
                    </div>
                    <p className="text-gray-600 mt-3">
                        {productData.description}
                    </p>
                    <p className="text-3xl font-medium mt-6">
                        {currency}{productData.offerPrice}
                        <span className="text-base font-normal text-gray-800/60 line-through ml-2">
                            {currency}{productData.price}
                        </span>
                    </p>
                    <hr className="bg-gray-600 my-6" />
                    <div className="overflow-x-auto">
                        <table className="table-auto border-collapse w-full max-w-72">
                            <tbody>
                                <tr>
                                    <td className="text-gray-600 font-medium">Brand</td>
                                    <td className="text-gray-800/50 ">Generic</td>
                                </tr>
                                <tr>
                                    <td className="text-gray-600 font-medium">Color</td>
                                    <td className="text-gray-800/50 ">Multi</td>
                                </tr>
                                <tr>
                                    <td className="text-gray-600 font-medium">Category</td>
                                    <td className="text-gray-800/50">
                                        {productData.category}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center mt-10 gap-4">
                        <button onClick={() => addToCart(productData._id)} className="w-full py-3.5 bg-gray-100 text-gray-800/80 hover:bg-gray-200 transition">
                            Add to Cart
                        </button>
                        <button onClick={() => { addToCart(productData._id); router.push('/cart') }} className="w-full py-3.5 bg-orange-500 text-white hover:bg-orange-600 transition">
                            Buy now
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex flex-col items-center">
                <div className="flex flex-col items-center mb-4 mt-16">
                    <p className="text-3xl font-medium">Featured <span className="font-medium text-orange-600">Products</span></p>
                    <div className="w-28 h-0.5 bg-orange-600 mt-2"></div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 mt-6 pb-14 w-full">
                    {products.slice(0, 5).map((product, index) => <ProductCard key={index} product={product} />)}
                </div>
                <button className="px-8 py-2 mb-16 border rounded text-gray-500/70 hover:bg-slate-50/90 transition">
                    See more
                </button>
            </div>
        </div>
        <Footer />
    </>
    )
};

export default Product;
