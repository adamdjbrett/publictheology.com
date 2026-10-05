import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";

let meta = {};
try {
	meta = loadYaml(readFileSync(fileURLToPath(new URL("./metadata.yaml", import.meta.url)), "utf8")) || {};
} catch {
	meta = {};
}

const base = String(meta.url || "").replace(/\/+$/, "");
const language = meta.language || "en";
const absolute = (url) => !url || String(url).startsWith("http") ? url : base + url;
const organizationMeta = meta.organization || {};
const organizationId = `${base}/#organization`;
const websiteId = `${base}/#website`;
const blogId = `${base}/#blog`;

const organization = {
	"@type": "Organization",
	"@id": organizationId,
	name: organizationMeta.name || meta.title,
	url: organizationMeta.url || `${base}/`,
};
if (meta.logo || meta.icon) organization.logo = { "@type": "ImageObject", url: absolute(meta.logo || meta.icon) };
if (organizationMeta.email) organization.email = organizationMeta.email;
if (organizationMeta.telephone) organization.telephone = organizationMeta.telephone;
if (organizationMeta.address) {
	organization.address = {
		"@type": "PostalAddress",
		streetAddress: organizationMeta.address.street,
		addressLocality: organizationMeta.address.locality,
		addressRegion: organizationMeta.address.region,
		postalCode: organizationMeta.address.postal_code,
		addressCountry: organizationMeta.address.country,
	};
}
const sameAs = (meta.social_accounts || []).map((account) => account.href).filter(Boolean);
if (sameAs.length) organization.sameAs = sameAs;

const publisher = { "@id": organizationId };
const website = {
	"@type": "WebSite",
	"@id": websiteId,
	name: meta.title,
	url: `${base}/`,
	description: meta.description,
	inLanguage: language,
	publisher,
	potentialAction: {
		"@type": "SearchAction",
		target: { "@type": "EntryPoint", urlTemplate: `${base}/search/?q={search_term_string}` },
		"query-input": "required name=search_term_string",
	},
};
const blog = {
	"@type": "Blog",
	"@id": blogId,
	name: meta.title,
	url: `${base}/`,
	description: meta.description,
	inLanguage: language,
	publisher,
	isPartOf: { "@id": websiteId },
};

export default {
	base,
	language,
	publisher,
	organization,
	website,
	blog,
	blogId,
	siteGraph: { "@context": "https://schema.org", "@graph": [organization, website, blog] },
};
