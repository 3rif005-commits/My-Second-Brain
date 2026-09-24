import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieWithOptions = { name: string; value: string; options: CookieOptions };

export async function proxy(request: NextRequest) {
  // If Supabase env vars are not set yet (local dev before .env.local is filled),
  // skip auth checks so pages can render without crashing.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieWithOptions[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session and establish who the user is. getClaims() verifies
  // the JWT locally (only falling back to the Auth server when it must) and
  // still refreshes an expired session — getUser() made a network round trip
  // to Supabase on EVERY request, page and API alike: 200–1000 ms each, and
  // the single largest cost of opening a workspace note.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub } : null;

  const { pathname } = request.nextUrl;

  // Unauthenticated users trying to access /brain/* → redirect to /login
  if (!user && pathname.startsWith("/brain")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated users visiting /login or /signup → redirect to /brain
  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/brain", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
