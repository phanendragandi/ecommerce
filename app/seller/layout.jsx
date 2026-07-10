'use client'
import Loading from '@/components/Loading'
import Navbar from '@/components/seller/Navbar'
import Sidebar from '@/components/seller/Sidebar'
import { useAppContext } from '@/context/AppContext'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'

const Layout = ({ children }) => {
  const { user, isSeller, authLoading, profileLoading } = useAppContext()
  const router = useRouter()

  // Still resolving the session/profile — never flash seller pages while
  // we don't yet know the caller's role.
  const resolving = authLoading || (!!user && profileLoading)

  useEffect(() => {
    if (resolving) return
    if (!user) {
      toast.error('Please log in to continue')
      router.replace('/login')
      return
    }
    if (!isSeller) {
      toast.error('Seller access required')
      router.replace('/')
    }
  }, [resolving, user, isSeller, router])

  if (resolving || !user || !isSeller) {
    return <Loading />
  }

  return (
    <div>
      <Navbar />
      <div className='flex w-full'>
        <Sidebar />
        {children}
      </div>
    </div>
  )
}

export default Layout
