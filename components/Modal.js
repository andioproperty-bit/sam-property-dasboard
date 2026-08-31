export default function Modal({ children, onClose }) {
  return (
    <div className="overlay" onClick={(e) => { if (e.target.classList.contains('overlay')) onClose(); }}>
      <div className="modal">{children}</div>
    </div>
  );
}
