'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { resetPassword } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Loader2, ArrowRight, Mail } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'

export default function ForgotPasswordPage() {
    const [isLoading, setIsLoading] = useState(false)
    const [success, setSuccess] = useState<string | null>(null)
    const { toast } = useToast()

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setIsLoading(true)

        const formData = new FormData(event.currentTarget)
        const result = await resetPassword(formData)

        if (result?.error) {
            toast({
                title: 'Error',
                description: result.error,
                variant: 'destructive',
            })
            setIsLoading(false)
        } else if (result?.success) {
            setSuccess(result.success)
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
                    <p className="text-slate-500 mt-2">Reset your password to get back in.</p>
                </div>

                <Card className="border-none shadow-2xl shadow-slate-200/50 rounded-2xl overflow-hidden bg-white/80 backdrop-blur-xl">
                    <AnimatePresence mode="wait">
                        {!success ? (
                            <motion.div
                                key="forgot-form"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            >
                                <CardHeader className="space-y-1 pb-6">
                                    <CardTitle className="text-xl font-semibold tracking-[-0.04em]">Forgot password?</CardTitle>
                                    <CardDescription>
                                        No worries, we'll send you reset instructions.
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
                                                className="rounded-xl border-slate-200 bg-white/50 focus:bg-white focus:ring-blue-500/20 transition-all duration-200"
                                            />
                                        </div>

                                        <Button
                                            type="submit"
                                            disabled={isLoading}
                                            className="w-full rounded-xl bg-slate-900 py-6 text-sm font-semibold text-white hover:bg-slate-800 transition-all active:scale-[0.98] disabled:opacity-70"
                                        >
                                            {isLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <span className="flex items-center justify-center gap-2">
                                                    Send reset link <ArrowRight className="h-4 w-4" />
                                                </span>
                                            )}
                                        </Button>
                                    </form>
                                </CardContent>
                                <CardFooter className="flex flex-col space-y-4 border-t border-slate-100 bg-slate-50/50 p-6 pt-6">
                                    <div className="text-center text-sm text-slate-500">
                                        Remember your password?{' '}
                                        <Link
                                            href="/login"
                                            className="font-semibold text-blue-600 hover:text-blue-500 transition-colors"
                                        >
                                            Sign in
                                        </Link>
                                    </div>
                                </CardFooter>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="success-message"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="p-8 text-center"
                            >
                                <div className="mb-4 flex justify-center">
                                    <Mail className="h-16 w-16 text-blue-500" />
                                </div>
                                <h3 className="text-xl font-bold tracking-tight text-slate-900">Email sent</h3>
                                <p className="mt-2 text-slate-500">
                                    Check your inbox for a password reset link.
                                </p>
                                <Button
                                    asChild
                                    variant="outline"
                                    className="mt-6 w-full rounded-xl border-slate-200"
                                >
                                    <Link href="/login">Back to sign in</Link>
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </Card>
            </motion.div>
        </div>
    )
}
