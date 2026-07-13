'use client'
import React, { useEffect, useState } from "react";
import { assets } from "@/assets/assets";
import Image from "next/image";
import { useAppContext } from "@/context/AppContext";
import Footer from "@/components/seller/Footer";
import Loading from "@/components/Loading";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

const normalizeProduct = (p) => ({
  _id: p.id,
  name: p.name,
  category: p.category,
  price: p.price,
  offerPrice: p.offer_price ?? p.price,
  image: Array.isArray(p.images) && p.images.length > 0 ? p.images : [assets.upload_area],
  isActive: p.is_active,
});

const ProductList = () => {

  const { router, currency } = useAppContext()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const fetchSellerProduct = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/seller/products')
      setProducts((res?.data?.products ?? []).map(normalizeProduct))
    } catch (err) {
      setError(err.message || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this product? Products that have been ordered are deactivated instead, to preserve order history.')) return;
    setDeletingId(id)
    try {
      const res = await api.delete(`/api/seller/products/${id}`)
      if (res?.data?.mode === 'deactivated') {
        toast.success('Product has orders — deactivated instead (hidden from the store)')
        setProducts((prev) => prev.map((p) => (p._id === id ? { ...p, isActive: false } : p)))
      } else {
        toast.success('Product permanently deleted')
        setProducts((prev) => prev.filter((p) => p._id !== id))
      }
    } catch (err) {
      toast.error(err.message || 'Failed to remove product')
    } finally {
      setDeletingId(null)
    }
  }

  const handleRestore = async (id) => {
    setDeletingId(id)
    try {
      await api.patch(`/api/seller/products/${id}`, { is_active: true })
      toast.success('Product restored to the store')
      setProducts((prev) => prev.map((p) => (p._id === id ? { ...p, isActive: true } : p)))
    } catch (err) {
      toast.error(err.message || 'Failed to restore product')
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    fetchSellerProduct();
  }, [])

  return (
    <div className="flex-1 min-h-screen flex flex-col justify-between">
      {loading ? <Loading /> : error ? (
        <div className="w-full md:p-10 p-4 flex flex-col items-center gap-4 py-20">
          <p className="text-gray-500">{error}</p>
          <button onClick={fetchSellerProduct} className="px-6 py-2 border rounded text-gray-500 hover:bg-slate-50 transition">
            Retry
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="w-full md:p-10 p-4">
          <h2 className="pb-4 text-lg font-medium">All Product</h2>
          <p className="text-gray-500 text-center py-16">No products yet. Add your first product to get started.</p>
        </div>
      ) : <div className="w-full md:p-10 p-4">
        <h2 className="pb-4 text-lg font-medium">All Product</h2>
        <div className="flex flex-col items-center max-w-4xl w-full overflow-hidden rounded-md bg-white border border-gray-500/20">
          <table className=" table-fixed w-full overflow-hidden">
            <thead className="text-gray-900 text-sm text-left">
              <tr>
                <th className="w-2/3 md:w-2/5 px-4 py-3 font-medium truncate">Product</th>
                <th className="px-4 py-3 font-medium truncate max-sm:hidden">Category</th>
                <th className="px-4 py-3 font-medium truncate">
                  Price
                </th>
                <th className="px-4 py-3 font-medium truncate max-sm:hidden">Action</th>
              </tr>
            </thead>
            <tbody className="text-sm text-gray-500">
              {products.map((product, index) => (
                <tr key={index} className="border-t border-gray-500/20">
                  <td className="md:px-4 pl-2 md:pl-4 py-3 flex items-center space-x-3 truncate">
                    <div className="bg-gray-500/10 rounded p-2">
                      <Image
                        src={product.image[0]}
                        alt="product Image"
                        className="w-16"
                        width={1280}
                        height={720}
                      />
                    </div>
                    <span className="truncate w-full">
                      {product.name}
                      {!product.isActive && (
                        <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-500 align-middle">Inactive</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-sm:hidden">{product.category}</td>
                  <td className="px-4 py-3">{currency}{product.offerPrice}</td>
                  <td className="px-4 py-3 max-sm:hidden">
                    <div className="flex items-center gap-2">
                      <button onClick={() => router.push(`/product/${product._id}`)} className="flex items-center gap-1 px-1.5 md:px-3.5 py-2 bg-orange-600 text-white rounded-md">
                        <span className="hidden md:block">Visit</span>
                        <Image
                          className="h-3.5"
                          src={assets.redirect_icon}
                          alt="redirect_icon"
                        />
                      </button>
                      {product.isActive ? (
                        <button
                          onClick={() => handleDelete(product._id)}
                          disabled={deletingId === product._id}
                          className="px-3 py-2 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 transition disabled:opacity-60"
                        >
                          {deletingId === product._id ? '...' : 'Delete'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRestore(product._id)}
                          disabled={deletingId === product._id}
                          className="px-3 py-2 border border-green-600/40 text-green-700 rounded-md hover:bg-green-50 transition disabled:opacity-60"
                        >
                          {deletingId === product._id ? '...' : 'Restore'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
      <Footer />
    </div>
  );
};

export default ProductList;
