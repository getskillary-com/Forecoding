import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
    href?: string;
    size?: number;
    showText?: boolean;
    adaptive?: boolean;
    className?: string;
    textClassName?: string;
    iconClassName?: string;
};

export function BrandLogo({
    href = "/",
    size = 32,
    showText = true,
    adaptive = true,
    className,
    textClassName,
    iconClassName
}: BrandLogoProps) {
    const iconSizeClass = adaptive
        ? "w-[clamp(22px,2.6vw,36px)] h-[clamp(22px,2.6vw,36px)]"
        : "";

    const textSizeClass = adaptive
        ? "text-[clamp(0.85rem,1.2vw,1rem)]"
        : "";

    const content = (
        <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
            <Image
                src="/forecoding-logo.png"
                alt="Forecoding logo"
                width={size}
                height={size}
                sizes="(max-width: 640px) 24px, (max-width: 1024px) 30px, 36px"
                className={`rounded-md ${iconSizeClass} ${iconClassName ?? ""}`}
                priority
            />
            {showText ? (
                <span className={`font-semibold text-gray-900 dark:text-gray-100 ${textSizeClass} ${textClassName ?? ""}`}>
                    Forecoding
                </span>
            ) : null}
        </span>
    );

    if (!href) {
        return content;
    }

    return (
        <Link href={href} className="inline-flex">
            {content}
        </Link>
    );
}
