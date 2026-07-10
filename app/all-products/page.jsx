'use client'
import ProductCard from "@/components/ProductCard";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Loading from "@/components/Loading";
import { useAppContext } from "@/context/AppContext";

const AllProducts = () => {

    const { products, productsLoading, productsError, fetchProductData } = useAppContext();

    return (
        <>
            <Navbar />
            <div className="flex flex-col items-start px-6 md:px-16 lg:px-32">
                <div className="flex flex-col items-end pt-12">
                    <p className="text-2xl font-medium">All products</p>
                    <div className="w-16 h-0.5 bg-orange-600 rounded-full"></div>
                </div>
                {productsLoading ? (
                    <div className="w-full"><Loading /></div>
                ) : productsError ? (
                    <div className="w-full flex flex-col items-center gap-4 py-20">
                        <p className="text-gray-500">{productsError}</p>
                        <button onClick={fetchProductData} className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition">
                            Retry
                        </button>
                    </div>
                ) : products.length === 0 ? (
                    <p className="w-full text-center text-gray-500 py-20">No products available yet.</p>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 flex-col items-center gap-6 mt-12 pb-14 w-full">
                        {products.map((product, index) => <ProductCard key={index} product={product} />)}
                    </div>
                )}
            </div>
            <Footer />
        </>
    );
};

export default AllProducts;
