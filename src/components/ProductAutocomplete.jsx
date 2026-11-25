import { useEffect, useRef, useState } from "react";

export default function ProductAutocomplete({
  value,
  products = [],
  onChange,
  onSelect
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef(null);

  const filteredProducts = products.filter((product) =>
    (product.name || "")
      .toLowerCase()
      .includes((value || "").toLowerCase().trim())
  );

  useEffect(() => {
    function handleOutsideClick(event) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () =>
      document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="autocomplete-wrapper" ref={wrapperRef}>
      <input
        type="text"
        value={value}
        placeholder="Search product..."
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
      />

      {showSuggestions && value.trim() && filteredProducts.length > 0 && (
        <div className="autocomplete-list">
          {filteredProducts.slice(0, 8).map((product) => (
            <button
              type="button"
              key={product.id}
              className="autocomplete-option"
              onClick={() => {
                onSelect(product);
                setShowSuggestions(false);
              }}
            >
              <strong>{product.name}</strong>
              <small>
                HSN: {product.hsn || "N/A"} | Rate: ₹
                {Number(product.rate || 0).toFixed(2)}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}