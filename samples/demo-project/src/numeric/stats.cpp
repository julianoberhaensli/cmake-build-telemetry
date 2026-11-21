#include <cmath>
#include <numeric>
#include <vector>

namespace numeric {
double mean(const std::vector<double>& v) {
  return v.empty() ? 0.0 : std::accumulate(v.begin(), v.end(), 0.0) / static_cast<double>(v.size());
}

double stddev(const std::vector<double>& v) {
  if (v.empty()) return 0.0;
  const double m = mean(v);
  double s = 0.0;
  for (double x : v) s += (x - m) * (x - m);
  return std::sqrt(s / static_cast<double>(v.size()));
}
}  // namespace numeric
