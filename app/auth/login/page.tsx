'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';

const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(100).optional(),
});

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6v-3.1H1.26a12 12 0 0 0 0 10.8l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.45-3.45C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.6l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard';
  const googleConfigured = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED === 'true';

  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '', name: '' },
  });

  const onSubmit = async (values: z.infer<typeof credentialsSchema>) => {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'register') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? 'Could not create account');
          setSubmitting(false);
          return;
        }
      }

      const result = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (result?.error) {
        setError('Incorrect email or password');
        setSubmitting(false);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'signin' ? 'Sign in to Tamgora' : 'Create your account'}</CardTitle>
          <CardDescription>
            {mode === 'signin'
              ? 'Welcome back — sign in to continue.'
              : 'Join Tamgora to post bounties or apply as a creator.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {googleConfigured && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => signIn('google', { callbackUrl })}
              >
                <GoogleIcon />
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {mode === 'register' && (
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </Button>
            </form>
          </Form>

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="font-medium text-foreground hover:underline"
              onClick={() => {
                setMode(mode === 'signin' ? 'register' : 'signin');
                setError(null);
              }}
            >
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
