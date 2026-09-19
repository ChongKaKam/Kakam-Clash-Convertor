export function profileUrl(baseUrl, item, device) {
  const url = `${baseUrl}/sub/${item.publicToken}/${device}.yaml`;
  // Clash Mi otherwise applies its default profile patch, which may replace the
  // subscription's routing rules. The query is ignored by this HTTP server.
  return device === 'ios' ? `${url}?overwrite=false` : url;
}
