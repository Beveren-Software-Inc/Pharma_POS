import type React from "react"
import { useState, useEffect, createContext, useContext } from "react"
import erpnextAPI from "../services/erpnext-api"

interface User {
  name: string
  email: string
  full_name: string
  role?: string
  first_name?: string
  last_name?: string
  user_image?: string
}

interface AuthContextType {
  user: User | null
  login: (
    username: string,
    password: string,
    otp?: string,
    tmpId?: string
  ) => Promise<{
    success: boolean
    message: string
    requires_otp?: boolean
    tmp_id?: string
    verification?: {
      method?: string
      prompt?: string
      setup?: boolean
      token_delivery?: boolean
    }
  }>
  logout: () => Promise<void>
  checkSession: () => Promise<boolean>
  loading: boolean
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    // Initialize ERPNext API session
    erpnextAPI.initializeSession()

    const clearLocalAuth = () => {
      localStorage.removeItem("erpnext_token")
      localStorage.removeItem("user_data")
      localStorage.removeItem("erpnext_sid")
      setUser(null)
    }

    const buildUser = (freshUserData: {
      name?: string
      email?: string
      full_name?: string
      first_name?: string
      last_name?: string
      role?: string
      role_profile_name?: string
      user_image?: string
    }, fallback?: User | null): User => ({
      name: freshUserData.name || fallback?.name || "",
      email: freshUserData.email || freshUserData.name || fallback?.email || "",
      full_name:
        freshUserData.full_name ||
        [freshUserData.first_name, freshUserData.last_name].filter(Boolean).join(" ") ||
        fallback?.full_name ||
        freshUserData.name ||
        "",
      role: freshUserData.role_profile_name || freshUserData.role || fallback?.role || "User",
      first_name: freshUserData.first_name,
      last_name: freshUserData.last_name,
      user_image: freshUserData.user_image,
    })

    const bootstrapAuth = async () => {
      const token = localStorage.getItem("erpnext_token")
      const userData = localStorage.getItem("user_data")
      let cachedUser: User | null = null

      if (token && userData) {
        try {
          cachedUser = JSON.parse(userData)
          // Optimistic UI from cache while we confirm the Frappe cookie session
          setUser(cachedUser)
        } catch (error) {
          console.error("Error parsing user data:", error)
          clearLocalAuth()
        }
      }

      try {
        // Reuse the active Frappe/desk session when present (same-origin cookie)
        const isSessionValid = await erpnextAPI.validateSession()
        if (!isSessionValid) {
          if (cachedUser) {
            console.warn("Session is invalid, clearing auth data")
          }
          clearLocalAuth()
          return
        }

        const freshUserData = await erpnextAPI.getCurrentUserProfile()
        if (freshUserData) {
          const updatedUser = buildUser(freshUserData, cachedUser)
          setUser(updatedUser)
          localStorage.setItem("erpnext_token", "authenticated")
          localStorage.setItem("user_data", JSON.stringify(updatedUser))
        } else if (!cachedUser) {
          clearLocalAuth()
        }
      } catch (error) {
        console.warn("Failed to bootstrap auth from Frappe session:", error)
        // Keep cached POS auth only if we already had it; otherwise stay logged out
        if (!cachedUser) {
          clearLocalAuth()
        }
      } finally {
        setLoading(false)
      }
    }

    bootstrapAuth()
  }, [mounted])

  const login = async (username: string, password: string, otp?: string, tmpId?: string) => {
    try {
      setLoading(true)

      // Use the real ERPNext API
      const result = await erpnextAPI.login(username, password, otp, tmpId)

      if (result.requires_otp) {
        return {
          success: false,
          message: result.message,
          requires_otp: true,
          tmp_id: result.tmp_id,
          verification: result.verification,
        }
      }

      if (result.success && result.user) {
        console.log("Login successful:", result.user)
        const userData = {
          name: result.user.name || username,
          email: result.user.email || username,
          full_name: result.user.full_name || result.user.name || username,
          role: result.user.role || "User",
        }

        setUser(userData)
        localStorage.setItem("erpnext_token", "authenticated")
        localStorage.setItem("user_data", JSON.stringify(userData))

        return { success: true, message: result.message }
      } else {
        return { success: false, message: result.message }
      }
    } catch (error) {
      console.error("Login error:", error)
      return { success: false, message: "Login failed. Please try again." }
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    await erpnextAPI.logout()
    setUser(null)
    localStorage.removeItem("erpnext_token")
    localStorage.removeItem("user_data")
    localStorage.removeItem("erpnext_sid")
  }

  // Method to check if session is still valid
  const checkSession = async () => {
    if (!user) return false

    try {
      const isValid = await erpnextAPI.validateSession()
      if (!isValid) {
        console.log("Session expired, logging out")
        await logout()
        return false
      }
      return true
    } catch (error) {
      console.error("Session check failed:", error)
      return false
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        checkSession,
        loading,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
