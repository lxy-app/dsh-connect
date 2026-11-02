import { ICON_URL } from './content';

type BrandLogoProps = {
  className: string;
  eager?: boolean;
};

export function BrandLogo({ className, eager = false }: BrandLogoProps) {
  return (
    <img
      className={className}
      src={ICON_URL}
      width={64}
      height={64}
      alt=""
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}
