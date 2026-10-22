import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db, 'users', u.uid));
        if (snap.exists() && snap.data().name) {
          setProfile(snap.data());
        } else {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);
  const saveProfile = async (data) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { ...data, uid: user.uid, email: user.email, createdAt: new Date() }, { merge: true });
    setProfile(data);
  };
  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
  };
  const isManager = profile?.role === 'manager' || profile?.role === 'admin';
  const isEvent = profile?.role === 'event';
  const isAdmin = profile?.role === 'admin';
  return (
    <AuthContext.Provider value={{ user, profile, loading, isManager, isEvent, isAdmin, saveProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
