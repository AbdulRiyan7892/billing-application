
import { useEffect, useRef, useState } from "react";

export default function CustomerAutocomplete({
  value,
  customers = [],
  onChange,
  onSelect
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef(null);

  const filteredCustomers = customers.filter((customer) =>
    (customer.name || "")
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
        placeholder="Enter customer name"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
      />

      {showSuggestions && value.trim() && filteredCustomers.length > 0 && (
        <div className="autocomplete-list">
          {filteredCustomers.slice(0, 8).map((customer) => (
            <button
              type="button"
              key={customer.id}
              className="autocomplete-option"
              onClick={() => {
                onSelect(customer);
                setShowSuggestions(false);
              }}
            >
              <strong>{customer.name}</strong>
              <small>
                {customer.gstin || "GSTIN not available"}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
