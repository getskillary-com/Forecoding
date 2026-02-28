export type AuthCodePurpose = "REGISTER" | "LOGIN" | "RESET_PASSWORD" | "CHANGE_EMAIL";

export const AuthCodePurposes = {
    register: "REGISTER" as AuthCodePurpose,
    login: "LOGIN" as AuthCodePurpose,
    resetPassword: "RESET_PASSWORD" as AuthCodePurpose,
    changeEmail: "CHANGE_EMAIL" as AuthCodePurpose
} as const;

