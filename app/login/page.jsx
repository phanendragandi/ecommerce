'use client'
import { assets } from "@/assets/assets";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import toast from "react-hot-toast";

const LoginForm = () => {

    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (searchParams.get('error') === 'auth_callback_failed') {
            toast.error('Google sign-in failed. Please try again.');
        }
    }, [searchParams]);

    const onSubmit = async (e) => {
        e.preventDefault();

        if (!email.trim() || !password) {
            toast.error('Email and password are required');
            return;
        }

        setSubmitting(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
            });
            if (error) throw error;
            toast.success('Logged in');
            router.push('/');
        } catch (err) {
            toast.error(err.message || 'Failed to log in');
        } finally {
            setSubmitting(false);
        }
    };

    const onGoogle = async () => {
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${window.location.origin}/auth/callback` },
            });
            if (error) throw error;
        } catch (err) {
            toast.error(err.message || 'Failed to start Google sign-in');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-6">
            <div className="w-full max-w-sm">
                <div className="flex justify-center mb-8">
                    <Image
                        className="cursor-pointer w-28 md:w-32"
                        onClick={() => router.push('/')}
                        src={assets.logo}
                        alt="logo"
                    />
                </div>
                <p className="text-2xl text-gray-500 text-center mb-8">
                    Welcome <span className="font-medium text-orange-600">back</span>
                </p>
                <form onSubmit={onSubmit} className="space-y-3">
                    <input
                        className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500"
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                    />
                    <input
                        className="px-2 py-2.5 focus:border-orange-500 transition border border-gray-500/30 rounded outline-none w-full text-gray-500"
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                    />
                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full mt-2 bg-orange-600 text-white py-3 hover:bg-orange-700 uppercase disabled:opacity-60"
                    >
                        {submitting ? 'Logging in...' : 'Login'}
                    </button>
                </form>
                <div className="flex items-center gap-3 my-5 text-xs text-gray-400">
                    <div className="flex-1 h-px bg-gray-300" />
                    OR
                    <div className="flex-1 h-px bg-gray-300" />
                </div>
                <button
                    onClick={onGoogle}
                    className="w-full border border-gray-500/30 rounded py-2.5 flex items-center justify-center gap-2 hover:bg-slate-50 transition text-gray-600"
                >
                    Continue with Google
                </button>
                <p className="text-center text-sm text-gray-500 mt-6">
                    New here?{' '}
                    <Link href="/signup" className="text-orange-600 hover:underline">
                        Create an account
                    </Link>
                </p>
            </div>
        </div>
    );
};

const LoginPage = () => (
    <Suspense fallback={null}>
        <LoginForm />
    </Suspense>
);

export default LoginPage;
