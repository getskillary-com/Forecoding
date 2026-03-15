import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Demo Workspace"
};

export default function DemoLayout({
    children
}: {
    children: React.ReactNode;
}) {
    return children;
}
