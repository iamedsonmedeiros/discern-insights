'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { login } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Loader2, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'

export default function LoginPage() {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { toast } = useToast()

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setIsLoading(true)
        setError(null)

        const formData = new FormData(event.currentTarget)
        const result = await login(formData)

        if (result?.error) {
            setError(result.error)
            toast({
                title: 'Login Error',
                description: result.error,
                variant: 'destructive',
            })
            setIsLoading(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-4 font-sans tracking-tight">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-full max-w-md"
            >
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold tracking-[-0.06em] text-slate-900">DISCERN Insights</h1>
                    <p className="text-slate-500 mt-2">Welcome back. Please enter your details.</p>
                </div>

                <Card className="border-none shadow-2xl shadow-slate-200/50 rounded-2xl overflow-hidden bg-white/80 backdrop-blur-xl">
                    <CardHeader className="space-y-1 pb-6">
                        <CardTitle className="text-xl font-semibold tracking-[-0.04em]">Sign in</CardTitle>
                        <CardDescription>
                            Enter your email and password to access your dashboard
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-sm font-medium text-slate-700">Email</Label>
                                <Input
                                    id="email"
                                    name="email"
                                    type="email"
                                    placeholder="name@example.com"
                                    required
                                    data-testid="login-email"
                                    className="rounded-xl border-slate-200 bg-white/50 focus:bg-white focus:ring-blue-500/20 transition-all duration-200"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="password" className="text-sm font-medium text-slate-700">Password</Label>
                                    <Link
                                        href="/forgot-password"
                                        className="text-xs font-medium text-blue-600 hover:text-blue-500 transition-colors"
                                    >
                                        Forgot password?
                                    </Link>
                                </div>
                                <Input
                                    id="password"
                                    name="password"
                                    type="password"
                                    required
                                    data-testid="login-password"
                                    className="rounded-xl border-slate-200 bg-white/50 focus:bg-white focus:ring-blue-500/20 transition-all duration-200"
                                />
                            </div>

                            <AnimatePresence mode="wait">
                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="text-sm font-medium text-red-500"
                                    >
                                        {error}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <Button
                                type="submit"
                                disabled={isLoading}
                                data-testid="login-submit"
                                className="w-full rounded-xl bg-slate-900 py-6 text-sm font-semibold text-white hover:bg-slate-800 transition-all active:scale-[0.98] disabled:opacity-70"
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <span className="flex items-center justify-center gap-2">
                                        Sign in <ArrowRight className="h-4 w-4" />
                                    </span>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                    <CardFooter className="flex flex-col space-y-4 border-t border-slate-100 bg-slate-50/50 p-6 pt-6">
                        <div className="text-center text-sm text-slate-500">
                            Don't have an account?{' '}
                            <Link
                                href="/signup"
                                className="font-semibold text-blue-600 hover:text-blue-500 transition-colors"
                            >
                                Sign up for free
                            </Link>
                        </div>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    )
}
