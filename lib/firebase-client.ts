"use client";

import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";

function readConfig() {
    return {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || ""
    };
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;

export function getFirebaseApp() {
    if (cachedApp) return cachedApp;

    const config = readConfig();
    if (!config.apiKey || !config.projectId || !config.appId) {
        throw new Error("Firebase client is not configured. Missing NEXT_PUBLIC_FIREBASE_* variables.");
    }

    cachedApp = getApps().length > 0 ? getApp() : initializeApp(config);
    return cachedApp;
}

export function getFirebaseAuth() {
    if (cachedAuth) return cachedAuth;
    cachedAuth = getAuth(getFirebaseApp());
    return cachedAuth;
}

