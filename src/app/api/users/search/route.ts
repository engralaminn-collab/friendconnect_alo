import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();

    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { username: { contains: q } },
              { name: { contains: q } },
              { email: { contains: q } },
            ],
          }
        : undefined,
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
      },
      take: 50,
    });

    return NextResponse.json({ users });
  } catch (error: any) {
    return NextResponse.json({ users: [], error: error.message }, { status: 500 });
  }
}
