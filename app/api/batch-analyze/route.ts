import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
    return NextResponse.json(
        { error: "Deep review is disabled." },
        { status: 410 }
    );
}
