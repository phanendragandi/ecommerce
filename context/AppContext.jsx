'use client'
import { assets } from "@/assets/assets";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

export const AppContext = createContext();

export const useAppContext = () => {
    return useContext(AppContext)
}

const GUEST_CART_KEY = 'quickcart_guest_cart'

const readGuestCart = () => {
    if (typeof window === 'undefined') return {}
    try {
        const raw = window.localStorage.getItem(GUEST_CART_KEY)
        return raw ? JSON.parse(raw) : {}
    } catch {
        return {}
    }
}

const writeGuestCart = (cart) => {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart))
    } catch {
        // storage unavailable (e.g. private mode) — cart stays in-memory only
    }
}

// Maps the Express /api/products row shape to the field names the existing
// UI components were built against (_id, image[], offerPrice) so the
// approved component markup doesn't need to change.
const normalizeProduct = (p) => ({
    _id: p.id,
    sellerId: p.seller_id,
    name: p.name,
    description: p.description,
    category: p.category,
    price: p.price,
    offerPrice: p.offer_price ?? p.price,
    image: Array.isArray(p.images) && p.images.length > 0 ? p.images : [assets.upload_area],
    stock: typeof p.stock === 'number' ? p.stock : 0,
    isActive: p.is_active,
})

const cartMapToItems = (cartMap) =>
    Object.entries(cartMap)
        .filter(([, qty]) => qty > 0)
        .map(([product_id, quantity]) => ({ product_id, quantity }))

const itemsToCartMap = (items) => {
    const map = {}
    for (const item of items || []) {
        if (item?.product_id && item.quantity > 0) {
            map[item.product_id] = item.quantity
        }
    }
    return map
}

// Sums guest + server quantities per product, capping at known stock.
const mergeCartMaps = (serverMap, guestMap, productsList) => {
    const merged = { ...serverMap }
    for (const [productId, qty] of Object.entries(guestMap)) {
        if (!(qty > 0)) continue
        const current = merged[productId] || 0
        let total = current + qty
        const product = productsList.find((p) => p._id === productId)
        if (product && typeof product.stock === 'number') {
            total = Math.min(total, product.stock)
        }
        if (total > 0) merged[productId] = total
    }
    return merged
}

export const AppContextProvider = (props) => {

    const currency = process.env.NEXT_PUBLIC_CURRENCY
    const router = useRouter()
    const supabase = createClient()

    const [products, setProducts] = useState([])
    const [productsLoading, setProductsLoading] = useState(true)
    const [productsError, setProductsError] = useState(null)

    const [user, setUser] = useState(null)
    const [profile, setProfile] = useState(null)
    const [authLoading, setAuthLoading] = useState(true)
    const [profileLoading, setProfileLoading] = useState(false)
    // Derived synchronously from profile — deriving it via useEffect opened a
    // one-render window where profileLoading was false but isSeller hadn't
    // updated yet, and the /seller layout redirected legitimate sellers away
    // on any hard navigation.
    const isSeller = profile?.role === 'seller'

    const [cartItems, setCartItems] = useState({})

    const [addresses, setAddresses] = useState([])
    const [addressesLoading, setAddressesLoading] = useState(false)

    const productsRef = useRef(products)
    useEffect(() => { productsRef.current = products }, [products])

    const userRef = useRef(null)
    useEffect(() => { userRef.current = user }, [user])

    const cartHydratedRef = useRef(false)
    const syncTimerRef = useRef(null)

    // Live mirror of cartItems so async flows (hydration) can see mutations
    // made after they started without re-subscribing to state.
    const cartItemsRef = useRef({})
    useEffect(() => { cartItemsRef.current = cartItems }, [cartItems])

    // ---- Products ---------------------------------------------------------

    const fetchProductData = useCallback(async () => {
        setProductsLoading(true)
        setProductsError(null)
        try {
            const res = await api.get('/api/products?limit=100', { auth: false })
            setProducts((res?.data?.products ?? []).map(normalizeProduct))
        } catch (err) {
            const message = err.message || 'Failed to load products'
            setProductsError(message)
            toast.error(message)
        } finally {
            setProductsLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchProductData()
    }, [fetchProductData])

    // ---- Profile ------------------------------------------------------

    const fetchUserData = useCallback(async () => {
        setProfileLoading(true)
        try {
            const res = await api.get('/api/me')
            setProfile(res?.data?.profile ?? null)
        } catch (err) {
            setProfile(null)
            toast.error(err.message || 'Failed to load your profile')
        } finally {
            setProfileLoading(false)
        }
    }, [])

    // ---- Addresses ------------------------------------------------------
    // Fetched lazily (on login, or on demand via refresh) so OrderSummary
    // and the add-address page can both read/refresh a single shared list
    // instead of each holding their own out-of-sync copy.

    // Callers are expected to only invoke this when a session exists (the
    // auth bootstrap below already gates it; add-address calls it right
    // after a successful authenticated POST). No internal auth guard here
    // to avoid a stale-ref race right after sign-in.
    const fetchAddresses = useCallback(async () => {
        setAddressesLoading(true)
        try {
            const res = await api.get('/api/addresses')
            setAddresses(res?.data?.addresses ?? [])
        } catch (err) {
            toast.error(err.message || 'Failed to load your addresses')
        } finally {
            setAddressesLoading(false)
        }
    }, [])

    // ---- Cart sync ----------------------------------------------------

    const syncCartToServer = useCallback(async (cartMap) => {
        if (!userRef.current) return
        try {
            await api.put('/api/cart', { items: cartMapToItems(cartMap) })
        } catch (err) {
            toast.error(err.message || 'Failed to sync cart')
        }
    }, [])

    const hydrateCart = useCallback(async (nextUser) => {
        cartHydratedRef.current = false
        if (nextUser) {
            const guestCart = readGuestCart()
            const preHydrate = cartItemsRef.current
            let serverMap = {}
            try {
                const res = await api.get('/api/cart')
                serverMap = itemsToCartMap(res?.data?.items)
            } catch (err) {
                toast.error(err.message || 'Failed to load your cart')
            }
            // Anything added while the server fetch was in flight would be
            // silently clobbered by the server copy — fold the delta in.
            const during = {}
            for (const [id, qty] of Object.entries(cartItemsRef.current)) {
                const added = qty - (preHydrate[id] || 0)
                if (added > 0) during[id] = added
            }
            let merged = mergeCartMaps(serverMap, guestCart, productsRef.current)
            merged = mergeCartMaps(merged, during, productsRef.current)
            setCartItems(merged)
            writeGuestCart({})
            cartHydratedRef.current = true
            await syncCartToServer(merged)
        } else {
            setCartItems(readGuestCart())
            cartHydratedRef.current = true
        }
    }, [syncCartToServer])

    // Debounced sync whenever the local cart changes for a logged-in user.
    useEffect(() => {
        if (!user) return
        if (!cartHydratedRef.current) return
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
        syncTimerRef.current = setTimeout(() => {
            syncCartToServer(cartItems)
        }, 800)
        return () => {
            if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
        }
    }, [cartItems, user, syncCartToServer])

    // Persist the guest cart locally whenever it changes while logged out.
    useEffect(() => {
        if (user) return
        writeGuestCart(cartItems)
    }, [cartItems, user])

    // ---- Auth bootstrap -------------------------------------------------

    useEffect(() => {
        let active = true

        const init = async () => {
            const { data: { session } } = await supabase.auth.getSession()
            if (!active) return
            const sessionUser = session?.user ?? null
            setUser(sessionUser)
            setAuthLoading(false)
            if (sessionUser) {
                await fetchUserData()
                await fetchAddresses()
            } else {
                setProfile(null)
                setAddresses([])
            }
            await hydrateCart(sessionUser)
        }

        init()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!active) return
            const sessionUser = session?.user ?? null
            setUser(sessionUser)

            if (event === 'SIGNED_IN') {
                await fetchUserData()
                await fetchAddresses()
                await hydrateCart(sessionUser)
            } else if (event === 'SIGNED_OUT') {
                setProfile(null)
                setAddresses([])
                writeGuestCart({})
                setCartItems({})
                cartHydratedRef.current = true
            }
        })

        return () => {
            active = false
            subscription.unsubscribe()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ---- Cart mutations (instant local UX) -----------------------------

    const addToCart = async (itemId) => {
        const product = productsRef.current.find((p) => p._id === itemId)
        const cap = typeof product?.stock === 'number' ? product.stock : null

        let blocked = false
        setCartItems((prev) => {
            const current = prev[itemId] || 0
            if (cap != null && current >= cap) {
                blocked = true
                return prev
            }
            return { ...prev, [itemId]: current + 1 }
        })
        if (blocked) toast.error('No more stock available')
    }

    const updateCartQuantity = async (itemId, quantity) => {
        const product = productsRef.current.find((p) => p._id === itemId)
        const cap = typeof product?.stock === 'number' ? product.stock : null

        setCartItems((prev) => {
            const next = { ...prev }
            if (quantity <= 0 || Number.isNaN(quantity)) {
                delete next[itemId]
                return next
            }
            next[itemId] = cap != null ? Math.min(quantity, cap) : quantity
            return next
        })
    }

    const clearCart = useCallback(() => {
        if (syncTimerRef.current) {
            clearTimeout(syncTimerRef.current)
            syncTimerRef.current = null
        }
        setCartItems({})
        writeGuestCart({})
        if (userRef.current) {
            syncCartToServer({})
        }
    }, [syncCartToServer])

    // Immediate, awaitable sync — used by the checkout flow right before
    // creating an order so the server cart matches what's on screen.
    const flushCart = useCallback(async () => {
        if (syncTimerRef.current) {
            clearTimeout(syncTimerRef.current)
            syncTimerRef.current = null
        }
        await syncCartToServer(cartItems)
    }, [cartItems, syncCartToServer])

    const getCartCount = () => {
        let totalCount = 0;
        for (const items in cartItems) {
            if (cartItems[items] > 0) {
                totalCount += cartItems[items];
            }
        }
        return totalCount;
    }

    const getCartAmount = () => {
        let totalAmount = 0;
        for (const items in cartItems) {
            let itemInfo = products.find((product) => product._id === items);
            if (itemInfo && cartItems[items] > 0) {
                totalAmount += itemInfo.offerPrice * cartItems[items];
            }
        }
        return Math.floor(totalAmount * 100) / 100;
    }

    // ---- Auth actions ---------------------------------------------------

    const logout = useCallback(async () => {
        try {
            const { error } = await supabase.auth.signOut()
            if (error) throw error
            toast.success('Logged out')
            router.push('/')
        } catch (err) {
            toast.error(err.message || 'Failed to log out')
        }
    }, [router, supabase])

    const value = {
        currency, router,
        // auth/session
        user, profile, authLoading, profileLoading, logout,
        isSeller,
        userData: profile, fetchUserData,
        // addresses
        addresses, addressesLoading, fetchAddresses,
        // products
        products, productsLoading, productsError, fetchProductData,
        // cart
        cartItems, setCartItems,
        addToCart, updateCartQuantity, clearCart, flushCart,
        getCartCount, getCartAmount
    }

    return (
        <AppContext.Provider value={value}>
            {props.children}
        </AppContext.Provider>
    )
}
