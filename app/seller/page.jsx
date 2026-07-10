'use client'
import React, { useState } from "react";
import { assets } from "@/assets/assets";
import Image from "next/image";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

const AddProduct = () => {

  const [files, setFiles] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Earphone');
  const [price, setPrice] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [stock, setStock] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setFiles([]);
    setName('');
    setDescription('');
    setCategory('Earphone');
    setPrice('');
    setOfferPrice('');
    setStock('');
  };

  const uploadImages = async (productId, imageFiles) => {
    const formData = new FormData();
    imageFiles.forEach((file) => formData.append('images', file));

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/seller/products/${productId}/images`, {
      method: 'POST',
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      body: formData,
    });

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }

    if (!res.ok) {
      throw new Error(data?.message || 'Failed to upload images');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const priceNum = Number(price);
    const offerPriceNum = Number(offerPrice);
    const stockNum = Number(stock);

    if (!name.trim() || !description.trim() || !category) {
      toast.error('Please fill in the product name, description and category');
      return;
    }
    if (!(priceNum > 0)) {
      toast.error('Price must be greater than 0');
      return;
    }
    if (!(offerPriceNum > 0)) {
      toast.error('Offer price must be greater than 0');
      return;
    }
    if (offerPriceNum > priceNum) {
      toast.error('Offer price cannot exceed price');
      return;
    }
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      toast.error('Stock must be a whole number of 0 or more');
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post('/api/seller/products', {
        name: name.trim(),
        description: description.trim(),
        category,
        price: priceNum,
        offer_price: offerPriceNum,
        stock: stockNum,
      });

      const productId = created?.data?.product?.id;
      const imageFiles = files.filter(Boolean);

      if (productId && imageFiles.length > 0) {
        try {
          await uploadImages(productId, imageFiles);
        } catch (uploadErr) {
          toast.error(uploadErr.message || 'Product saved, but image upload failed');
          resetForm();
          return;
        }
      }

      toast.success('Product added');
      resetForm();
    } catch (err) {
      toast.error(err.message || 'Failed to add product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-screen flex flex-col justify-between">
      <form onSubmit={handleSubmit} className="md:p-10 p-4 space-y-5 max-w-lg">
        <div>
          <p className="text-base font-medium">Product Image</p>
          <div className="flex flex-wrap items-center gap-3 mt-2">

            {[...Array(4)].map((_, index) => (
              <label key={index} htmlFor={`image${index}`}>
                <input onChange={(e) => {
                  const updatedFiles = [...files];
                  updatedFiles[index] = e.target.files[0];
                  setFiles(updatedFiles);
                }} type="file" id={`image${index}`} hidden />
                <Image
                  key={index}
                  className="max-w-24 cursor-pointer"
                  src={files[index] ? URL.createObjectURL(files[index]) : assets.upload_area}
                  alt=""
                  width={100}
                  height={100}
                />
              </label>
            ))}

          </div>
        </div>
        <div className="flex flex-col gap-1 max-w-md">
          <label className="text-base font-medium" htmlFor="product-name">
            Product Name
          </label>
          <input
            id="product-name"
            type="text"
            placeholder="Type here"
            className="outline-none md:py-2.5 py-2 px-3 rounded border border-gray-500/40"
            onChange={(e) => setName(e.target.value)}
            value={name}
            required
          />
        </div>
        <div className="flex flex-col gap-1 max-w-md">
          <label
            className="text-base font-medium"
            htmlFor="product-description"
          >
            Product Description
          </label>
          <textarea
            id="product-description"
            rows={4}
            className="outline-none md:py-2.5 py-2 px-3 rounded border border-gray-500/40 resize-none"
            placeholder="Type here"
            onChange={(e) => setDescription(e.target.value)}
            value={description}
            required
          ></textarea>
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex flex-col gap-1 w-32">
            <label className="text-base font-medium" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              className="outline-none md:py-2.5 py-2 px-3 rounded border border-gray-500/40"
              onChange={(e) => setCategory(e.target.value)}
              value={category}
            >
              <option value="Earphone">Earphone</option>
              <option value="Headphone">Headphone</option>
              <option value="Watch">Watch</option>
              <option value="Smartphone">Smartphone</option>
              <option value="Laptop">Laptop</option>
              <option value="Camera">Camera</option>
              <option value="Accessories">Accessories</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-base font-medium" htmlFor="product-price">
              Product Price
            </label>
            <input
              id="product-price"
              type="number"
              placeholder="0"
              className="outline-none md:py-2.5 py-2 px-3 rounded border border-gray-500/40"
              onChange={(e) => setPrice(e.target.value)}
              value={price}
              required
            />
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-base font-medium" htmlFor="offer-price">
              Offer Price
            </label>
            <input
              id="offer-price"
              type="number"
              placeholder="0"
              className="outline-none md:py-2.5 py-2 px-3 rounded border border-gray-500/40"
              onChange={(e) => setOfferPrice(e.target.value)}
              value={offerPrice}
              required
            />
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-base font-medium" htmlFor="product-stock">
              Stock
            </label>
            <input
              id="product-stock"
              type="number"
              placeholder="0"
              className="outline-none md:py-2.5 py-2 px-3 rounded border border-gray-500/40"
              onChange={(e) => setStock(e.target.value)}
              value={stock}
              required
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-8 py-2.5 bg-orange-600 text-white font-medium rounded disabled:opacity-60"
        >
          {submitting ? 'Adding...' : 'ADD'}
        </button>
      </form>
      {/* <Footer /> */}
    </div>
  );
};

export default AddProduct;
