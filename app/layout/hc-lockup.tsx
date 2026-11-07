import { Link } from "react-router";

export default function HcLockup() {
  return (
    <div className="hc-site">
      <a
        className="hc-home"
        href="https://hackallcode.ru/"
        aria-label="hack[*]code, home"
        title="hackallcode.ru"
      />
      <span className="hc-sep" aria-hidden="true" />
      <Link className="hc-site-name" to="/">
        <svg className="hc-site-ico" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="6" r="2.5" />
          <circle cx="19" cy="6" r="2.5" />
          <circle cx="12" cy="19" r="2.5" />
          <path d="M7.5 6h9M6.2 8.3l4.6 8.4M17.8 8.3l-4.6 8.4" />
          <circle className="hc-dot" cx="12" cy="10.5" r="1.6" />
        </svg>
        Mesh
      </Link>
    </div>
  );
}
