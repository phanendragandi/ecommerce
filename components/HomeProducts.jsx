import React from "react";
import ProductCard from "./ProductCard";
import Loading from "./Loading";
import { useAppContext } from "@/context/AppContext";

const HomeProducts = () => {

  const { products, productsLoading, router } = useAppContext()

  return (
    <div className="flex flex-col items-center pt-14">
      <p className="text-2xl font-medium text-left w-full">Popular products</p>
      {productsLoading ? (
        <div className="w-full"><Loading /></div>
      ) : products.length === 0 ? (
        <p className="w-full text-center text-gray-500 py-14">No products available yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 flex-col items-center gap-6 mt-6 pb-14 w-full">
          {products.map((product, index) => <ProductCard key={index} product={product} />)}
        </div>
      )}
      <button onClick={() => { router.push('/all-products') }} className="px-12 py-2.5 border rounded text-gray-500/70 hover:bg-slate-50/90 transition">
        See more
      </button>
    </div>
  );
};

export default HomeProducts;
