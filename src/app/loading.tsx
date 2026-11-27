export default function Loading() {
  return (
    <div
      style={{
        minHeight: "55vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
      aria-busy="true"
      aria-label="Loading page"
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "3px solid #EAD5C0",
          borderTopColor: "#7A1230",
          animation: "ms-store-spin 0.7s linear infinite",
        }}
      />
      <style>{`@keyframes ms-store-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
