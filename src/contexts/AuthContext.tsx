import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type UserRole = 'admin' | 'user';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userRole: UserRole | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName?: string, phone?: string) => Promise<{ error: Error | null }>;
  signUpWithPhone: (phone: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signIn: (emailOrPhone: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  sendOTP: (type: 'email' | 'phone', destination: string) => Promise<{ error: Error | null; otpToken?: string }>;
  verifyOTPAndResetPassword: (otpToken: string, otp: string, destination: string, newPassword: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Error fetching user role:', error);
        return null;
      }

      return data?.role as UserRole;
    } catch (error) {
      console.error('Error fetching user role:', error);
      return null;
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        // Defer role fetching with setTimeout to prevent deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchUserRole(session.user.id).then(setUserRole);
          }, 0);
        } else {
          setUserRole(null);
        }

        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        fetchUserRole(session.user.id).then(setUserRole);
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string, phone?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          phone: phone
        }
      }
    });

    // If signup successful and phone provided, update profile with phone
    if (!error && data?.user && phone) {
      await supabase
        .from('profiles')
        .update({ phone })
        .eq('user_id', data.user.id);
    }

    return { error: error as Error | null };
  };

  const signUpWithPhone = async (phone: string, password: string, fullName?: string) => {
    // For phone-based signup, we create a temporary email
    const tempEmail = `${phone.replace(/[^0-9]/g, '')}@phone.local`;
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email: tempEmail,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          phone: phone
        }
      }
    });

    // Update profile with phone number
    if (!error && data?.user) {
      await supabase
        .from('profiles')
        .update({ phone })
        .eq('user_id', data.user.id);
    }

    return { error: error as Error | null };
  };

  const signIn = async (emailOrPhone: string, password: string) => {
    // Check if input looks like a phone number
    const isPhone = emailOrPhone.startsWith('+') || /^\d{10,}$/.test(emailOrPhone.replace(/[^0-9]/g, ''));
    
    let email = emailOrPhone;
    
    if (isPhone) {
      // Look up the email associated with this phone number
      const normalizedPhone = emailOrPhone.startsWith('+') ? emailOrPhone : `+${emailOrPhone.replace(/[^0-9]/g, '')}`;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('phone', normalizedPhone)
        .single();
      
      if (profile?.email) {
        email = profile.email;
      } else {
        // Try with temp email format
        email = `${normalizedPhone.replace(/[^0-9]/g, '')}@phone.local`;
      }
    }
    
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUserRole(null);
  };

  const resetPassword = async (email: string) => {
    const redirectUrl = `${window.location.origin}/auth?mode=reset`;
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl
    });

    return { error: error as Error | null };
  };

  const sendOTP = async (type: 'email' | 'phone', destination: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('send-otp', {
        body: { type, destination, purpose: 'reset_password' }
      });

      if (error) {
        return { error: error as Error };
      }

      if (data?.error) {
        return { error: new Error(data.error) };
      }

      return { error: null, otpToken: data?.otpToken };
    } catch (err: any) {
      return { error: err as Error };
    }
  };

  const verifyOTPAndResetPassword = async (otpToken: string, otp: string, destination: string, newPassword: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { otpToken, otp, destination, newPassword }
      });

      if (error) {
        return { error: error as Error };
      }

      if (data?.error) {
        return { error: new Error(data.error) };
      }

      return { error: null };
    } catch (err: any) {
      return { error: err as Error };
    }
  };

  const value = {
    user,
    session,
    userRole,
    loading,
    signUp,
    signUpWithPhone,
    signIn,
    signOut,
    resetPassword,
    sendOTP,
    verifyOTPAndResetPassword
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
