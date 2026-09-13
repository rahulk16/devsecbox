const searchInput = document.getElementById("searchInput");
const cards = Array.from(document.querySelectorAll(".tool-card"));
const grid = document.getElementById("toolsGrid");
const noResults = document.getElementById("noResults");

searchInput.addEventListener("input", () => {
	const q = searchInput.value.trim().toLowerCase();
	let visibleCount = 0;

	cards.forEach((card) => {
		const name = card.dataset.name.toLowerCase();
		const desc = card.dataset.desc.toLowerCase();
		const matches = q === "" || name.includes(q) || desc.includes(q);
		card.style.display = matches ? "" : "none";
		if (matches) visibleCount++;
	});

	noResults.style.display = visibleCount === 0 ? "block" : "none";
});

document.getElementById("year").textContent = new Date().getFullYear();
