// src/services/authService.ts
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  User,
} from "firebase/auth";
import { auth } from "../config/firebaseConfig";

// Tipos de resultado
type Ok = { success: true; user: User };
type Fail = {
  success: false;
  code: string;
  message: string;
  friendlyMessage: string;
};
export type AuthResult = Ok | Fail;

// Mapeo simple de errores a mensajes entendibles para el usuario
function mapAuthError(e: any): Fail {
  const code: string = e?.code ?? "auth/unknown";
  let friendly = "Ocurrió un error. Intenta de nuevo.";

  switch (code) {
    case "auth/invalid-email":
      friendly = "El correo no es válido.";
      break;
    case "auth/user-not-found":
      friendly = "Usuario aún no registrado.";
      break;
    case "auth/wrong-password":
      friendly = "Contraseña incorrecta.";
      break;
    case "auth/email-already-in-use":
      friendly = "Ese correo ya está registrado.";
      break;
    case "auth/weak-password":
      friendly = "La contraseña es muy débil (mín. 6 caracteres).";
      break;
  }
  return {
    success: false,
    code,
    message: e?.message ?? String(e),
    friendlyMessage: friendly,
  };
}

// INICIAR SESIÓN
export async function signIn(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const res = await signInWithEmailAndPassword(auth, email.trim(), password);
    return { success: true, user: res.user };
  } catch (e) {
    return mapAuthError(e);
  }
}

// REGISTRAR USUARIO
export async function signUp(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const res = await createUserWithEmailAndPassword(
      auth,
      email.trim(),
      password
    );
    return { success: true, user: res.user };
  } catch (e) {
    return mapAuthError(e);
  }
}

// CERRAR SESIÓN
export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
