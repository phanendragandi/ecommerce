"use client"
import React, { useState } from "react";
import { assets } from "@/assets/assets";
import Link from "next/link"
import { useAppContext } from "@/context/AppContext";
import Image from "next/image";

const Navbar = () => {

  const { isSeller, router, user, profile, logout } = useAppContext();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
  };

  const AccountMenu = () => (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((open) => !open)}
        className="flex items-center gap-2 hover:text-gray-900 transition"
      >
        <Image src={assets.user_icon} alt="user icon" />
        {user ? (profile?.name || 'Account') : 'Account'}
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-md shadow-md text-sm z-20 overflow-hidden">
            {user ? (
              <>
                <button
                  onClick={() => { setMenuOpen(false); router.push('/my-orders'); }}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100"
                >
                  My Orders
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => { setMenuOpen(false); router.push('/login'); }}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100"
                >
                  Login
                </button>
                <button
                  onClick={() => { setMenuOpen(false); router.push('/signup'); }}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100"
                >
                  Sign up
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <nav className="flex items-center justify-between px-6 md:px-16 lg:px-32 py-3 border-b border-gray-300 text-gray-700">
      <Image
        className="cursor-pointer w-28 md:w-32"
        onClick={() => router.push('/')}
        src={assets.logo}
        alt="logo"
      />
      <div className="flex items-center gap-4 lg:gap-8 max-md:hidden">
        <Link href="/" className="hover:text-gray-900 transition">
          Home
        </Link>
        <Link href="/all-products" className="hover:text-gray-900 transition">
          Shop
        </Link>
        <Link href="/" className="hover:text-gray-900 transition">
          About Us
        </Link>
        <Link href="/" className="hover:text-gray-900 transition">
          Contact
        </Link>

        {isSeller && <button onClick={() => router.push('/seller')} className="text-xs border px-4 py-1.5 rounded-full">Seller Dashboard</button>}

      </div>

      <ul className="hidden md:flex items-center gap-4 ">
        <Image className="w-4 h-4" src={assets.search_icon} alt="search icon" />
        <AccountMenu />
      </ul>

      <div className="flex items-center md:hidden gap-3">
        {isSeller && <button onClick={() => router.push('/seller')} className="text-xs border px-4 py-1.5 rounded-full">Seller Dashboard</button>}
        <AccountMenu />
      </div>
    </nav>
  );
};

export default Navbar;
